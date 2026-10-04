"use strict";

const {
  computeProductPricing,
  computeProductRating,
} = require("../../utils/product-pricing");
const {
  getProductSalesRanking,
  selectBestSellerDocumentIds,
  selectTopSellingDocumentIds,
  hasRecordedSales,
  DEFAULT_BEST_SELLER_RAIL,
} = require("../../utils/best-sellers");
const {
  PRODUCT_RANK,
  rankProductIdsByPrice,
} = require("../../utils/product-sort");
const { getDescendantCategoryIds } = require("../../utils/category-tree");
const { createTtlCache } = require("../../utils/ttl-cache");
const {
  AVAILABILITY_STATUS,
  AVAILABILITY_LABELS,
} = require("../../utils/inventory");

const PRODUCT_UID = "api::product.product";
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

const FALLBACK_AVAILABILITY = {
  status: AVAILABILITY_STATUS.OUT_OF_STOCK,
  label: AVAILABILITY_LABELS[AVAILABILITY_STATUS.OUT_OF_STOCK],
  availableQuantity: 0,
};

/** Kept in sync with product/schema.json (asserted in tests). */
const HEALTH_CONDITIONS = [
  "NONE",
  "STERILIZED",
  "RENAL",
  "URINARY",
  "GASTRO",
  "SKIN",
  "HAIRBALL",
  "WEIGHT_CONTROL",
  "DIABETIC",
  "JOINT",
  "SENSITIVE",
];

const AGE_GROUPS = ["puppy", "kitten", "junior", "adult", "senior", "all"];

/**
 * The one ProductSortInput contract.
 *
 * A string value is a REAL Product column and is ordered by the database.
 * `null` means "not a Product column": the order is resolved in the domain
 * layer after the candidate query, never by asking Strapi to sort by a key
 * its schema does not have.
 *
 * PRICE_ASC / PRICE_DESC / DISCOUNT are null for exactly that reason —
 * MOPET price and discount live on ProductVariant, so `sort: ["price:asc"]`
 * on Product is a `ValidationError: Invalid key price` waiting to happen.
 * utils/product-sort.js orders those three by variant price instead (which
 * IS a DB-level sort, just on the table that owns the column).
 */
const SORT_MAP = {
  NEWEST: "createdAt:desc",
  NAME_ASC: "name:asc",
  NAME_DESC: "name:desc",
  BEST_SELLING: null,
  PRICE_ASC: null,
  PRICE_DESC: null,
  DISCOUNT: null,
};

/** Sorts resolved below the query, against the variant/domain layer. */
const DOMAIN_RANKED_SORTS = new Set([
  "BEST_SELLING",
  "PRICE_ASC",
  "PRICE_DESC",
  "DISCOUNT",
]);

const PRODUCT_POPULATE = {
  variants: {
    populate: {
      attributes: true,
      inventories: true,
    },
  },
  brand: true,
  category: true,
  images: true,
  campaigns: true,
  reviews: {
    filters: { approved: true },
  },
};

function clampPageSize(value) {
  const n = Number.isInteger(value) ? value : DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, n));
}

function clampPage(value) {
  return Number.isInteger(value) && value > 0 ? value : 1;
}

const MAX_BEST_SELLER_RAIL = 50;

/**
 * How deep the best-seller rail goes. A rail is a TOP-N, not "the whole
 * category in sales order", so this is a real bound rather than a page size:
 * page/pageSize still page WITHIN it.
 */
function clampBestSellerLimit(value) {
  const n = Number.isInteger(value) ? value : DEFAULT_BEST_SELLER_RAIL;
  return Math.min(MAX_BEST_SELLER_RAIL, Math.max(1, n));
}

function buildFilters(
  args,
  { categoryDocumentIds = null, bestSellerDocumentIds = null } = {},
) {
  const filters = {};

  if (categoryDocumentIds?.length) {
    filters.category = { documentId: { $in: categoryDocumentIds } };
  } else if (args.category) {
    filters.category = { documentId: { $eq: args.category } };
  }

  if (args.brand) {
    filters.brand = { documentId: { $eq: args.brand } };
  }

  // PHASE 6: the storefront's Problem Finder resolves a customer-stated
  // problem ("ریزش مو", "مشکل گوارشی") onto Product.healthCondition, which
  // is the only field in the model that carries that meaning. Without these
  // two arguments the Problem Finder had no authoritative way to select
  // products and would have had to guess client-side.
  if (typeof args.healthCondition === "string" && args.healthCondition) {
    filters.healthCondition = { $eq: args.healthCondition };
  }

  if (typeof args.ageGroup === "string" && args.ageGroup) {
    // "all" products suit every age group, so an age filter must include them.
    filters.ageGroup =
      args.ageGroup === "all"
        ? { $eq: "all" }
        : { $in: [args.ageGroup, "all"] };
  }

  if (typeof args.search === "string" && args.search.trim()) {
    const search = args.search.trim()
      .replace(/[يى]/g, "ی")
      .replace(/ك/g, "ک")
      .replace(/\u200c/g, " ");
    filters.$or = [
      { name: { $containsi: search } },
      { shortDescription: { $containsi: search } },
      { searchKeywords: { $containsi: search } },
      { brand: { name: { $containsi: search } } },
      { category: { name: { $containsi: search } } },
      { variants: { sku: { $containsi: search } } },
    ];
  }

  if (bestSellerDocumentIds) {
    const ids = [...bestSellerDocumentIds];
    filters.documentId = ids.length
      ? { $in: ids }
      : { $eq: "__mopet_no_best_sellers__" };
  }

  if (args.minPrice != null || args.maxPrice != null) {
    filters.variants = { price: {} };
    if (args.minPrice != null) filters.variants.price.$gte = args.minPrice;
    if (args.maxPrice != null) filters.variants.price.$lte = args.maxPrice;
  }

  return filters;
}

async function reconcileProductsExpiry(strapi, products) {
  const inventoryService = strapi.service("api::inventory.inventory");
  const rows = products.flatMap((product) =>
    (product.variants || [])
      .map((variant) => variant.inventories)
      .filter(Array.isArray),
  );

  await Promise.all(rows.map((inventories) => inventoryService.reconcileExpiry(inventories)));
}

function toProductCard(product, bestSellerIds) {
  const pricing = computeProductPricing(product);
  const rating = computeProductRating(product.reviews);

  return {
    documentId: product.documentId,
    name: product.name,
    slug: product.slug,
    images: product.images ?? [],
    category: product.category
      ? {
          documentId: product.category.documentId,
          name: product.category.name,
          slug: product.category.slug,
        }
      : null,
    brand: product.brand
      ? {
          name: product.brand.name,
          slug: product.brand.slug ?? null,
        }
      : null,
    selectedVariant: pricing.selectedVariant ?? null,
    variants: pricing.variants ?? [],
    startingPrice: pricing.startingPrice ?? null,
    originalPrice: pricing.originalPrice ?? null,
    finalPrice: pricing.finalPrice ?? null,
    hasDiscount: pricing.hasDiscount ?? false,
    discountAmount: pricing.discountAmount ?? null,
    averageRating: rating.averageRating,
    reviewCount: rating.reviewCount,
    isBestSeller: bestSellerIds?.has(product.documentId) ?? false,
    availability: pricing.availability ?? FALLBACK_AVAILABILITY,
  };
}

// Safety valve: BEST_SELLING has to rank the whole matching set before it
// can paginate, so an unbounded catalogue scan is capped rather than
// allowed to become a slow query. 2000 is far above any real category.
const MAX_RANKED_CANDIDATES = 2000;

/**
 * The homepage renders one section per animal plus one per child
 * category, so the same category trees are resolved many times within a
 * single render. A short TTL collapses that into one lookup each without
 * ever serving a stale taxonomy (see utils/ttl-cache.js).
 */
const categoryTreeCache = createTtlCache({ ttlMs: 30_000, maxEntries: 100 });

module.exports = ({ nexus, strapi }) => {

  return {
    types: [
      nexus.enumType({
        name: "ProductSortInput",
        members: Object.keys(SORT_MAP),
      }),
      // Mirrors the Product schema enumerations exactly (see
      // src/api/product/content-types/product/schema.json). Declared as
      // enums so an unknown value is rejected by GraphQL validation
      // instead of silently returning the whole catalogue.
      nexus.enumType({
        name: "ProductHealthCondition",
        members: HEALTH_CONDITIONS,
      }),
      nexus.enumType({
        name: "ProductAgeGroup",
        members: AGE_GROUPS,
      }),
      nexus.objectType({
        name: "ProductListResult",
        definition(t) {
          t.nonNull.list.nonNull.field("items", { type: "ProductCard" });
          t.nonNull.int("page");
          t.nonNull.int("pageSize");
          t.nonNull.int("total");
        },
      }),
      nexus.extendType({
        type: "Query",
        definition(t) {
          t.nonNull.field("productList", {
            type: "ProductListResult",
            args: {
              category: nexus.idArg(),
              brand: nexus.idArg(),
              minPrice: nexus.floatArg(),
              maxPrice: nexus.floatArg(),
              search: nexus.stringArg(),
              healthCondition: nexus.arg({ type: "ProductHealthCondition" }),
              ageGroup: nexus.arg({ type: "ProductAgeGroup" }),
              includeDescendants: nexus.booleanArg({ default: false }),
              bestSeller: nexus.booleanArg({ default: false }),
              /* Depth of the best-seller rail. Ignored unless bestSeller. */
              bestSellerLimit: nexus.intArg({
                default: DEFAULT_BEST_SELLER_RAIL,
              }),
              sort: nexus.arg({ type: "ProductSortInput", default: "NEWEST" }),
              page: nexus.intArg({ default: 1 }),
              pageSize: nexus.intArg({ default: DEFAULT_PAGE_SIZE }),
            },
            resolve: async (_parent, args) => {
              const page = clampPage(args.page);
              const pageSize = clampPageSize(args.pageSize);
              let resolvedCategoryIds = null;

              try {
                if (args.category && args.includeDescendants) {
                  resolvedCategoryIds = await getDescendantCategoryIds(
                    strapi,
                    args.category,
                    { includeRoot: true, cache: categoryTreeCache },
                  );
                }

                const baseFilters = buildFilters(args, {
                  categoryDocumentIds: resolvedCategoryIds,
                });
                /* Domain-ranked sorts still need a deterministic, VALID
                   candidate order to page against, so they borrow NEWEST. */
                const candidateSort = DOMAIN_RANKED_SORTS.has(args.sort)
                  ? SORT_MAP.NEWEST
                  : (SORT_MAP[args.sort] ?? SORT_MAP.NEWEST);

                let candidates = await strapi.documents(PRODUCT_UID).findMany({
                  filters: baseFilters,
                  status: "published",
                  // Only the columns needed to order and paginate: the
                  // heavy populate happens once, for the current page.
                  fields: ["name", "createdAt"],
                  sort: candidateSort,
                  limit: MAX_RANKED_CANDIDATES,
                });

                if (candidates.length === MAX_RANKED_CANDIDATES) {
                  strapi.log.warn(
                    `[MOPET productList] candidate cap reached (${MAX_RANKED_CANDIDATES}) for category ${
                      args.category ?? "any"
                    }; ranking is limited to the first page of candidates.`,
                  );
                }

                let salesRanking = null;
                let bestSellerIds = null;

                if (args.sort === "BEST_SELLING" || args.bestSeller) {
                  salesRanking = await getProductSalesRanking(strapi, {
                    productDocumentIds: candidates.map((item) => item.documentId),
                  });
                  bestSellerIds = selectBestSellerDocumentIds(salesRanking);
                }

                if (args.bestSeller) {
                  /* The RAIL rule, not the BADGE rule. Using the badge
                     predicate here (top decile AND totalSold > 0) is what made
                     this rail render nothing — see utils/best-sellers.js. The
                     rail is the scoped catalogue ORDERED by real sales and
                     truncated to a top-N, so it is never empty while the scope
                     has published products, and never fabricated either. */
                  const railIds = selectTopSellingDocumentIds(salesRanking, {
                    limit: clampBestSellerLimit(args.bestSellerLimit),
                  });
                  const position = new Map(
                    railIds.map((id, index) => [id, index]),
                  );

                  candidates = candidates
                    .filter((item) => position.has(item.documentId))
                    .sort(
                      (a, b) =>
                        position.get(a.documentId) - position.get(b.documentId),
                    );

                  if (!hasRecordedSales(salesRanking)) {
                    /* Observable, not silent: the rail is correct but it is
                       ordering on a scope with no recorded sales yet. */
                    strapi.log.warn(
                      `[MOPET productList] best-seller rail has no recorded sales in scope ${
                        args.category ?? "any"
                      }; ordering fell back to the scoped catalogue order.`,
                    );
                  }
                }

                if (args.sort === "BEST_SELLING" && !args.bestSeller) {
                  const rank = new Map(
                    salesRanking.map((item, index) => [item.documentId, index]),
                  );
                  candidates.sort(
                    (a, b) =>
                      (rank.get(a.documentId) ?? Number.MAX_SAFE_INTEGER) -
                      (rank.get(b.documentId) ?? Number.MAX_SAFE_INTEGER),
                  );
                }

                /*
                 * PRICE_ASC / PRICE_DESC / DISCOUNT: ordered by the price the
                 * card actually advertises (lowest active variant price after
                 * discount), computed from ProductVariant. Ranking happens
                 * over the whole candidate set before paging, so page 2 of
                 * "cheapest first" is genuinely the next-cheapest page.
                 */
                if (PRODUCT_RANK[args.sort] && args.sort !== "BEST_SELLING") {
                  const ordered = await rankProductIdsByPrice(
                    strapi,
                    candidates.map((item) => item.documentId),
                    { rank: PRODUCT_RANK[args.sort] },
                  );

                  const priceRank = new Map(
                    ordered.map((id, index) => [id, index]),
                  );

                  candidates.sort(
                    (a, b) =>
                      (priceRank.get(a.documentId) ?? Number.MAX_SAFE_INTEGER) -
                      (priceRank.get(b.documentId) ?? Number.MAX_SAFE_INTEGER),
                  );
                }

                const total = candidates.length;
                const start = (page - 1) * pageSize;
                const pageIds = candidates
                  .slice(start, start + pageSize)
                  .map((item) => item.documentId);

                let products = [];

                if (pageIds.length > 0) {
                  products = await strapi.documents(PRODUCT_UID).findMany({
                    filters: { documentId: { $in: pageIds } },
                    status: "published",
                    populate: PRODUCT_POPULATE,
                  });

                  const order = new Map(pageIds.map((id, index) => [id, index]));
                  products.sort(
                    (a, b) => order.get(a.documentId) - order.get(b.documentId),
                  );
                  await reconcileProductsExpiry(strapi, products);
                }

                strapi.log.debug(
                  `[MOPET productList] ${JSON.stringify({
                    categoryId: args.category ?? null,
                    includeDescendants: args.includeDescendants,
                    resolvedCategoryIds,
                    sort: args.sort,
                    bestSeller: args.bestSeller,
                    page,
                    pageSize,
                    total,
                    returnedIds: products.map((item) => item.documentId),
                  })}`,
                );

                return {
                  items: products.map((product) =>
                    toProductCard(product, bestSellerIds),
                  ),
                  page,
                  pageSize,
                  total,
                };
              } catch (error) {
                strapi.log.error(
                  `[MOPET productList] failed ${JSON.stringify({
                    categoryId: args.category ?? null,
                    includeDescendants: args.includeDescendants,
                    resolvedCategoryIds,
                    sort: args.sort,
                    bestSeller: args.bestSeller,
                    page,
                    pageSize,
                    message: error.message,
                  })}`,
                );
                throw error;
              }
            },
          });
        },
      }),
    ],
    resolversConfig: {
      "Query.productList": { auth: false },
    },
  };
};

module.exports.buildFilters = buildFilters;
module.exports.clampPage = clampPage;
module.exports.clampPageSize = clampPageSize;
module.exports.clampBestSellerLimit = clampBestSellerLimit;
module.exports.SORT_MAP = SORT_MAP;
module.exports.DOMAIN_RANKED_SORTS = DOMAIN_RANKED_SORTS;
module.exports.HEALTH_CONDITIONS = HEALTH_CONDITIONS;
module.exports.AGE_GROUPS = AGE_GROUPS;
