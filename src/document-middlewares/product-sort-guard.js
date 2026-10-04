"use strict";

/**
 * Document Service middleware: THE INVARIANT.
 *
 *   > No Product Document Service query may ever receive `price`
 *   > as a Product-level sort key.
 *
 * WHY THIS EXISTS ON TOP OF utils/product-sort.js
 * -----------------------------------------------
 * `utils/product-sort.js` is the sorting AUTHORITY: every deliberate MOPET
 * code path (api::product.product#filterProducts, the `productList` GraphQL
 * resolver, the product controller's `find`) resolves its sort through it,
 * so a price sort is answered by the ProductVariant layer instead of being
 * handed to Strapi.
 *
 * But an authority only protects the callers that use it, and a Product
 * `findMany` is reachable from paths this project does not own:
 *
 *   - the CORE content-api route `GET /api/products?sort=price:asc`
 *     (createCoreRouter -> createCoreController#find -> sanitizeQuery ->
 *     Document Service). `price` is not a Product attribute, so Strapi 5's
 *     `validateSort` throws `ValidationError: Invalid key price` before any
 *     MOPET code runs. THIS is the request that produced the original
 *     production error, and `api::product.product.find` is granted to the
 *     public role in src/bootstrap/permissions.js.
 *   - the auto-generated (shadow CRUD) GraphQL query
 *     `products(sort: ["price:asc"])`, also public.
 *   - `/api/products/search`, admin-panel list views, plugins
 *     (meilisearch, documentation) and any future programmatic caller.
 *
 * A controller override cannot cover those. `strapi.documents.use()` wraps
 * EVERY Document Service call regardless of caller, which is why the publish
 * validation already lives here (see product-publish-validation.js) and why
 * the invariant is enforced here too.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not swallow the error, does not add `price` to Product, and does
 * not disable Strapi validation. It rewrites the *sort* — the one part of
 * the query that is provably invalid — to Product-level keys that do exist,
 * records the price intent on the params so an aware caller can rank by
 * variant price, and logs a warning naming the caller. Anything else invalid
 * in the query still fails loudly.
 */

const {
  DEFAULT_SORT,
  PRODUCT_RANK,
  classifyProductSortKey,
  normalizeSortEntries,
  rankForSortKey,
} = require("../utils/product-sort");

const PRODUCT_UID = "api::product.product";

/** Read actions whose params carry a `sort`. */
const SORTED_ACTIONS = new Set([
  "findMany",
  "findFirst",
  "findPage",
  "findOne",
  "count",
]);

/**
 * Set by the guard on the params object so a caller that DOES understand
 * ranking can detect that price intent was moved to the domain layer
 * instead of having to guess.
 */
const RANK_HINT = Symbol.for("mopet.productSort.rank");

function describeCaller() {
  const stack = new Error().stack?.split("\n").slice(2) ?? [];

  const frame = stack.find(
    (line) =>
      !line.includes("product-sort-guard") &&
      !line.includes("node:internal") &&
      line.includes("("),
  );

  return frame ? frame.trim() : "unknown caller";
}

/**
 * Removes ONLY the keys that mean "order by price/discount/sales" — the ones
 * that are structurally impossible on Product — and leaves every other key
 * exactly as the caller sent it.
 *
 * That distinction is deliberate. A key like `images` or `totallyMadeUp` is a
 * BAD REQUEST, and Strapi answering it with a 400 is correct behaviour; this
 * middleware is not a laundry for invalid input. `price` is different: it is a
 * legitimate thing to ask a product listing for, it just does not live on the
 * Product table, so it is answered one layer down instead of rejected.
 *
 * @returns {{ changed: boolean, sort: unknown, rank: string|null, offending: string[] }}
 */
function sanitizeSort(sort) {
  const entries = normalizeSortEntries(sort);

  if (entries.length === 0) {
    return { changed: false, sort, rank: null, offending: [] };
  }

  const kept = [];
  const offending = [];
  let rank = null;

  for (const entry of entries) {
    if (classifyProductSortKey(entry.key) === "rank") {
      offending.push(entry.key);
      rank = rank ?? rankForSortKey(entry.key, entry.direction);
      continue;
    }

    /* Valid Product columns AND unknown keys both stay: the first because
       they work, the second so Strapi still rejects them. */
    kept.push(`${entry.key}:${entry.direction}`);
  }

  if (offending.length === 0) {
    return { changed: false, sort, rank: null, offending: [] };
  }

  return {
    changed: true,
    sort: kept.length > 0 ? kept : DEFAULT_SORT,
    rank,
    offending,
  };
}

function registerProductSortGuard(strapi) {
  strapi.documents.use(async (context, next) => {
    if (context.uid !== PRODUCT_UID) return next();
    if (!SORTED_ACTIONS.has(context.action)) return next();

    const params = context.params;

    if (!params || params.sort == null) return next();

    const { changed, sort, rank, offending } = sanitizeSort(params.sort);

    if (!changed) return next();

    const isPriceIntent =
      rank === PRODUCT_RANK.PRICE_ASC ||
      rank === PRODUCT_RANK.PRICE_DESC ||
      rank === PRODUCT_RANK.DISCOUNT;

    params.sort = sort;

    if (rank) params[RANK_HINT] = rank;

    strapi.log?.warn?.(
      `[MOPET productSortGuard] rewrote Product sort ${JSON.stringify(
        offending,
      )} -> ${JSON.stringify(sort)}${
        isPriceIntent
          ? ` (price/discount order is a ProductVariant concern; ranked as ${rank} by the domain layer when the caller supports it)`
          : ""
      }. Caller: ${describeCaller()}`,
    );

    return next();
  });
}

module.exports = {
  PRODUCT_UID,
  RANK_HINT,
  SORTED_ACTIONS,
  registerProductSortGuard,
  sanitizeSort,
};
