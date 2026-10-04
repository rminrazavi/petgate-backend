"use strict";

/**
 * `Invalid key price` — the GraphQL half of the invariant.
 *
 * THE GAP THIS CLOSES
 * -------------------
 * Two layers already enforce "no Product query may receive `price` as a
 * Product-level sort key":
 *
 *   utils/product-sort.js                the authority every MOPET code path
 *                                        resolves its sort through
 *   document-middlewares/product-sort-guard.js
 *                                        `strapi.documents.use()`, so it wraps
 *                                        every Document Service call
 *
 * The Document Service middleware is the last line before the query builder,
 * which makes it the right place for callers this project does not own — but it
 * is only reached if the caller actually gets as far as the Document Service.
 * On the shadow-CRUD GraphQL path
 *
 *     query { products(sort: ["price:asc"]) { documentId } }
 *
 * the plugin sanitises and validates the incoming args against the content type
 * BEFORE it builds Document Service params. `price` is not a Product attribute,
 * so that validation can reject the operation while the sort is still an
 * argument on the GraphQL field — upstream of anything `strapi.documents.use()`
 * can see.
 *
 * This extension therefore normalises `sort` where it first exists: on the
 * resolver's arguments. It reuses the SAME classification the other two layers
 * use (`sanitizeSort` from the document middleware), so there is one definition
 * of "this key means price" in the codebase, not three.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 *  - it does not add `price` to Product;
 *  - it does not swallow errors — a genuinely unknown key such as `totallyMadeUp`
 *    is left in place so GraphQL still rejects the operation;
 *  - it does not silently drop price ordering: `productList` (the resolver the
 *    storefront actually uses) ranks by ProductVariant.price through
 *    utils/product-sort.js. Shadow CRUD has no ranking stage, so a price sort
 *    there degrades to the default Product order and says so in the log.
 */

const {
  sanitizeSort,
} = require("../../document-middlewares/product-sort-guard");

/**
 * Shadow-CRUD Product read fields. `products_connection` is the paginated form
 * and takes the same `sort` argument.
 */
const GUARDED_RESOLVERS = ["Query.products", "Query.products_connection"];

/**
 * Wraps a resolver so `args.sort` is normalised before it runs.
 *
 * Deliberately total: if anything about the middleware itself goes wrong the
 * original arguments are passed through untouched. A guard must never be the
 * reason a catalogue query fails.
 */
function guardSortArg(strapi) {
  return async (next, parent, args, context, info) => {
    try {
      if (args && args.sort != null) {
        const { changed, sort, rank, offending } = sanitizeSort(args.sort);

        if (changed) {
          args.sort = sort;

          strapi.log?.warn?.(
            `[MOPET productSortGraphql] rewrote shadow-CRUD Product sort ${JSON.stringify(
              offending,
            )} -> ${JSON.stringify(
              sort,
            )} (price/discount order is a ProductVariant concern; use the productList query, which ranks as ${rank}).`,
          );
        }
      }
    } catch (error) {
      strapi.log?.error?.(
        `[MOPET productSortGraphql] guard skipped: ${error.message}`,
      );
    }

    return next(parent, args, context, info);
  };
}

module.exports = ({ strapi }) => {
  const middleware = guardSortArg(strapi);

  return {
    resolversConfig: Object.fromEntries(
      GUARDED_RESOLVERS.map((name) => [name, { middlewares: [middleware] }]),
    ),
  };
};

module.exports.GUARDED_RESOLVERS = GUARDED_RESOLVERS;
module.exports.guardSortArg = guardSortArg;
