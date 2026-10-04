"use strict";

/**
 * PRODUCT SORTING — the one authority on what a Product query may ORDER BY.
 * =======================================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Strapi 5's Document Service validates every `sort` key against the content
 * type's own schema (`validateSort` -> `findMany`). MOPET's Product schema
 * (src/api/product/content-types/product/schema.json) has NO `price`
 * attribute, because MOPET pricing is variant-dependent:
 *
 *     Product
 *       └── ProductVariant   (isActive, isDefault)
 *             ├── price
 *             └── discountPrice
 *
 * So this is invalid and throws `ValidationError: Invalid key price`:
 *
 *     strapi.documents("api::product.product").findMany({ sort: ["price:asc"] })
 *
 * The fix is NOT to add a `price` column to Product, not to swallow the
 * exception, and not to drop price ordering. Price sorting is real product
 * behaviour ("cheapest first", "most discounted first"), it simply cannot be
 * expressed as a Product column. It is resolved one layer down instead:
 *
 *     Strapi query
 *           |   sort keys that really exist on Product (DB level)
 *     ProductVariant.price / .discountPrice  (DB-level sort, valid: the
 *           |                                 column exists on THAT table)
 *     data mapper / domain layer
 *           |   min effective price per product, discount depth
 *     computed / display price ordering
 *
 * Everything that needs price order goes through `resolveProductSort` +
 * `rankProductIdsByPrice`. Nothing passes a caller-supplied sort straight
 * into a Product `findMany` again.
 */

const price = require("./price");

const VARIANT_UID = "api::product-variant.product-variant";

/**
 * Product columns Strapi can actually ORDER BY.
 * Mirrors product/schema.json scalar attributes plus the Strapi built-ins.
 * Relations, components, media and `blocks` are not sortable, and `price` is
 * deliberately, permanently absent.
 */
const PRODUCT_SORTABLE_KEYS = new Set([
  "id",
  "documentId",
  "name",
  "slug",
  "createdAt",
  "updatedAt",
  "publishedAt",
  "averageRating",
  "reviewCount",
  "countryOfOrigin",
  "ageGroup",
  "healthCondition",
]);

/** Domain-layer rankings. Not DB sorts: resolved after the query. */
const PRODUCT_RANK = {
  PRICE_ASC: "PRICE_ASC",
  PRICE_DESC: "PRICE_DESC",
  DISCOUNT: "DISCOUNT",
  BEST_SELLING: "BEST_SELLING",
};

/**
 * Sort keys a client may send that MEAN "order by price". Each one is a
 * variant-level concept, so it is answered by the domain layer rather than
 * rejected outright or silently ignored.
 */
const PRICE_KEYS = new Set([
  "price",
  "prices",
  "finalprice",
  "startingprice",
  "effectiveprice",
  "displayprice",
  "discountprice",
  "variants.price",
  "variant.price",
  "variants.finalprice",
]);

const DISCOUNT_KEYS = new Set([
  "discount",
  "discountamount",
  "discountpercent",
  "discountpercentage",
  "hasdiscount",
]);

const BEST_SELLING_KEYS = new Set([
  "bestselling",
  "bestseller",
  "sales",
  "salescount",
  "popularity",
]);

const DEFAULT_SORT = "createdAt:desc";

/** Guard so a huge listing cannot turn variant ranking into a table scan. */
const MAX_RANKED_VARIANTS = 5000;

function toDirection(value) {
  return String(value ?? "asc").toLowerCase() === "desc" ? "desc" : "asc";
}

/**
 * Accepts every shape Strapi accepts (`"a:asc"`, `"a"`, `["a:asc", ...]`,
 * `{ a: "asc" }`, `[{ a: "asc" }]`) and flattens it to entries. Unknown
 * shapes flatten to nothing rather than reaching the query builder.
 */
function normalizeSortEntries(input) {
  if (input == null) return [];

  if (Array.isArray(input)) {
    return input.flatMap((item) => normalizeSortEntries(item));
  }

  if (typeof input === "string") {
    return input
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, direction] = part.split(":");
        return { key: String(key).trim(), direction: toDirection(direction) };
      });
  }

  if (typeof input === "object") {
    return Object.entries(input).flatMap(([key, value]) => {
      // Nested relation sort, e.g. { variants: { price: "asc" } }.
      if (value && typeof value === "object") {
        return normalizeSortEntries(value).map((entry) => ({
          key: `${key}.${entry.key}`,
          direction: entry.direction,
        }));
      }

      return [{ key: String(key).trim(), direction: toDirection(value) }];
    });
  }

  return [];
}

/**
 * Classifies ONE sort entry. Exported so callers that must not change the
 * meaning of a query (the Document Service guard) can tell the difference
 * between "this key means price" and "this key is simply not a Product
 * column" — the first is answered by the variant layer, the second is a bad
 * request that Strapi should still reject.
 *
 * @returns {"product"|"rank"|"unknown"}
 */
function classifyProductSortKey(key) {
  if (PRODUCT_SORTABLE_KEYS.has(key)) return "product";

  const normalized = String(key).toLowerCase();

  if (
    PRICE_KEYS.has(normalized) ||
    DISCOUNT_KEYS.has(normalized) ||
    BEST_SELLING_KEYS.has(normalized)
  ) {
    return "rank";
  }

  return "unknown";
}

/** The ranking a "rank" key asks for, or `null`. */
function rankForSortKey(key, direction = "asc") {
  const normalized = String(key).toLowerCase();

  if (PRICE_KEYS.has(normalized)) {
    return toDirection(direction) === "desc"
      ? PRODUCT_RANK.PRICE_DESC
      : PRODUCT_RANK.PRICE_ASC;
  }

  if (DISCOUNT_KEYS.has(normalized)) return PRODUCT_RANK.DISCOUNT;
  if (BEST_SELLING_KEYS.has(normalized)) return PRODUCT_RANK.BEST_SELLING;

  return null;
}

/**
 * Turns a caller-supplied sort into (a) a sort Strapi will accept for a
 * Product query and (b) an optional domain-layer ranking.
 *
 * @returns {{ sort: string[]|string, rank: string|null, rejected: string[] }}
 *   `sort`      - only keys that exist on Product. Never empty.
 *   `rank`      - a PRODUCT_RANK value when price/discount order was asked
 *                 for, so the caller resolves it below the query.
 *   `rejected`  - keys that mean nothing at all, for logging. Sorting is
 *                 never silently dropped without a trace.
 */
function resolveProductSort(input, { fallback = DEFAULT_SORT } = {}) {
  const entries = normalizeSortEntries(input);

  const sort = [];
  const rejected = [];
  let rank = null;

  for (const entry of entries) {
    const key = entry.key.toLowerCase();

    if (PRODUCT_SORTABLE_KEYS.has(entry.key)) {
      sort.push(`${entry.key}:${entry.direction}`);
      continue;
    }

    if (PRICE_KEYS.has(key)) {
      // Price is not a Product column. Record the INTENT; the domain layer
      // orders by the variant price the customer actually sees.
      rank =
        rank ??
        (entry.direction === "desc"
          ? PRODUCT_RANK.PRICE_DESC
          : PRODUCT_RANK.PRICE_ASC);
      continue;
    }

    if (DISCOUNT_KEYS.has(key)) {
      rank = rank ?? PRODUCT_RANK.DISCOUNT;
      continue;
    }

    if (BEST_SELLING_KEYS.has(key)) {
      rank = rank ?? PRODUCT_RANK.BEST_SELLING;
      continue;
    }

    rejected.push(entry.key);
  }

  return {
    sort: sort.length > 0 ? sort : fallback,
    rank,
    rejected,
  };
}

/** Display price of one variant: discountPrice when set, else price. */
function variantEffectivePrice(variant) {
  const value = Number(variant?.price);

  if (!Number.isFinite(value) || value <= 0) return null;

  return price.calculateFinalPrice({
    price: value,
    discountPrice:
      variant.discountPrice == null ? null : Number(variant.discountPrice),
  });
}

/**
 * Loads the active variants of `documentIds` and reduces them to one
 * comparable number per product.
 *
 * The DB-level `sort` here is `price` on PRODUCT-VARIANT, where the column
 * genuinely exists, so the Document Service validates it happily. This is
 * the "valid database-level sorting where supported" step of the pipeline.
 */
async function loadProductPriceIndex(
  strapi,
  documentIds,
  { direction = "asc" } = {},
) {
  const ids = [...new Set((documentIds ?? []).filter(Boolean))];

  if (ids.length === 0) return new Map();

  const limit = Math.min(MAX_RANKED_VARIANTS, Math.max(ids.length * 25, 100));

  const variants = await strapi.documents(VARIANT_UID).findMany({
    filters: {
      product: { documentId: { $in: ids } },
      isActive: true,
    },
    fields: ["price", "discountPrice", "isActive", "isDefault"],
    populate: { product: { fields: ["documentId"] } },
    sort: [`price:${toDirection(direction)}`],
    limit,
  });

  if (variants.length === limit) {
    strapi.log?.warn?.(
      `[MOPET productSort] variant ranking hit the ${limit}-row cap; price order may be partial.`,
    );
  }

  const index = new Map();

  for (const variant of variants) {
    const productId =
      typeof variant.product === "string"
        ? variant.product
        : variant.product?.documentId;

    if (!productId) continue;

    const computed = variantEffectivePrice(variant);

    if (!computed) continue;

    const current = index.get(productId) ?? {
      // The card advertises the LOWEST buyable price (`startingPrice` in
      // utils/product-pricing.js), so price order must use the same number
      // or the list would contradict the prices printed on it.
      displayPrice: computed.finalPrice,
      maxPrice: computed.finalPrice,
      discountPercent: 0,
    };

    current.displayPrice = Math.min(current.displayPrice, computed.finalPrice);
    current.maxPrice = Math.max(current.maxPrice, computed.finalPrice);

    const percent = computed.hasDiscount
      ? (computed.originalPrice - computed.finalPrice) / computed.originalPrice
      : 0;

    current.discountPercent = Math.max(current.discountPercent, percent);

    index.set(productId, current);
  }

  return index;
}

function compareByRank(rank) {
  if (rank === PRODUCT_RANK.PRICE_DESC) {
    return (a, b) => b.displayPrice - a.displayPrice;
  }

  if (rank === PRODUCT_RANK.DISCOUNT) {
    return (a, b) => b.discountPercent - a.discountPercent;
  }

  return (a, b) => a.displayPrice - b.displayPrice;
}

/**
 * Orders `documentIds` by variant-derived price or discount.
 *
 * Products with no active, validly priced variant advertise no price at
 * all, so they cannot be positioned by price: they keep their incoming
 * relative order and go LAST. The sort is stable, so a product's position
 * never flips between two identical requests.
 */
async function rankProductIdsByPrice(strapi, documentIds, { rank } = {}) {
  const ids = (documentIds ?? []).filter(Boolean);

  if (ids.length <= 1 || !rank) return ids;

  const index = await loadProductPriceIndex(strapi, ids, {
    direction: rank === PRODUCT_RANK.PRICE_DESC ? "desc" : "asc",
  });

  const compare = compareByRank(rank);

  const priced = [];
  const unpriced = [];

  ids.forEach((id, position) => {
    const entry = index.get(id);

    if (entry) priced.push({ id, position, ...entry });
    else unpriced.push({ id, position });
  });

  priced.sort((a, b) => compare(a, b) || a.position - b.position);

  return [...priced.map((item) => item.id), ...unpriced.map((item) => item.id)];
}

module.exports = {
  DEFAULT_SORT,
  MAX_RANKED_VARIANTS,
  PRODUCT_RANK,
  PRODUCT_SORTABLE_KEYS,
  classifyProductSortKey,
  loadProductPriceIndex,
  normalizeSortEntries,
  rankForSortKey,
  rankProductIdsByPrice,
  resolveProductSort,
  variantEffectivePrice,
};
