"use strict";

const SUPPORTED_PERIODS = ["all_time"];

function validatePeriod(period) {
  if (!SUPPORTED_PERIODS.includes(period)) {
    throw new Error(
      `Unsupported sales period "${period}". Supported: ${SUPPORTED_PERIODS.join(", ")}.`,
    );
  }
}

/**
 * Canonical product sales aggregation. Inventory.sold is already the
 * project's completed-sale counter, so all product surfaces share this one
 * implementation. Knex `?` binding is intentional; PostgreSQL `$1` caused
 * the previous "Expected 1 bindings, saw 0" failure in Knex.raw().
 *
 * Scoping the aggregation to a set of products uses one `?` placeholder per
 * id, generated to match the number of bindings. This is the only shape that
 * survives Knex's raw-binding rules: Knex expands an *array* binding into a
 * comma-separated list of values, so the previous `= ANY(?::text[])` with
 * `bindings = [productDocumentIds]` was rendered as
 * `= ANY('p1', 'p2'::text[])` — invalid PostgreSQL, which made every scoped
 * call (i.e. every BEST_SELLING productList query) throw instead of rank.
 * An empty scope still returns early above, so `IN ()` can never be emitted.
 */
async function getProductSalesRanking(
  strapi,
  { period = "all_time", productDocumentIds = null } = {},
) {
  validatePeriod(period);

  if (Array.isArray(productDocumentIds) && productDocumentIds.length === 0) {
    return [];
  }

  const isScoped = Array.isArray(productDocumentIds);

  // documentId is a text column in Strapi 5; String() keeps the bindings
  // type-consistent without changing any caller's contract.
  const bindings = isScoped ? productDocumentIds.map(String) : [];

  const scopeSql = isScoped
    ? `AND p.document_id IN (${bindings.map(() => "?").join(", ")})`
    : "";

  const { rows } = await strapi.db.connection.raw(
    `
      WITH active_variants AS (
        SELECT DISTINCT pvpl.product_id, pvpl.product_variant_id
        FROM product_variants_product_lnk pvpl
        JOIN product_variants pv
          ON pv.id = pvpl.product_variant_id
         AND pv.is_active = true
      ),
      variant_inventory_edges AS (
        SELECT DISTINCT ipvl.product_variant_id, ipvl.inventory_id
        FROM inventories_product_variant_lnk ipvl
      )
      SELECT
        p.document_id AS "documentId",
        p.name AS "name",
        p.slug AS "slug",
        COALESCE(SUM(inv.sold), 0)::int AS "totalSold"
      FROM products p
      LEFT JOIN active_variants av ON av.product_id = p.id
      LEFT JOIN variant_inventory_edges vie
        ON vie.product_variant_id = av.product_variant_id
      LEFT JOIN inventories inv ON inv.id = vie.inventory_id
      WHERE p.published_at IS NOT NULL
        ${scopeSql}
      GROUP BY p.id, p.document_id, p.name, p.slug
      ORDER BY "totalSold" DESC, p.document_id ASC
    `,
    bindings,
  );

  return rows.map((row) => ({
    documentId: row.documentId,
    name: row.name,
    slug: row.slug,
    totalSold: Number(row.totalSold) || 0,
  }));
}

/**
 * The BADGE rule: which products earn the "پرفروش" flag on their own card.
 *
 * Deliberately strict — the top decile of the scope AND at least one recorded
 * sale — because a badge on everything is a badge on nothing. This is NOT the
 * rule for the best-seller RAIL; selectTopSellingDocumentIds below documents why
 * conflating the two is what emptied the homepage rail.
 */
const BEST_SELLER_BADGE_PERCENTILE = 0.1;

function selectBestSellerDocumentIds(ranking) {
  if (!ranking.length) return new Set();

  const cutoff = Math.ceil(ranking.length * BEST_SELLER_BADGE_PERCENTILE);

  return new Set(
    ranking
      .filter((row) => row.totalSold > 0)
      .slice(0, cutoff)
      .map((row) => row.documentId),
  );
}

/** A rail shorter than this reads as an accident, so it is the fill threshold. */
const MIN_BEST_SELLER_RAIL = 4;
const DEFAULT_BEST_SELLER_RAIL = 24;

/**
 * The RAIL rule: the ordered document ids the "پرفروش‌ترین محصولات" rail shows.
 *
 * ROOT CAUSE THIS FIXES. The homepage rail used to be selected with
 * selectBestSellerDocumentIds() — the BADGE predicate — applied to the
 * category-scoped candidate set. Two consequences, both of which surfaced as
 * "the best sellers section shows no products":
 *
 *   1. `Math.ceil(scope * 0.1)` over one species subtree is one to three ids on
 *      a real catalogue, so the rail was a near-empty stub even when it worked.
 *   2. `totalSold > 0` made the set EMPTY for any scope with no recorded sales
 *      (a fresh install, a newly published species, or a category whose sales
 *      sit on inactive variants). Empty set -> zero candidates -> `items: []`.
 *      Nothing downstream was broken: resolver, mapper and ProductCard were all
 *      correct and simply had nothing to render.
 *
 * The rail rule instead ORDERS the real, scoped catalogue by real sales:
 *   - products with recorded sales come first, highest first (the ranking query
 *     is already `totalSold DESC, document_id ASC`, so it is deterministic);
 *   - when fewer than `minRailSize` products in the scope have any recorded
 *     sale, the remainder of that same scope follows in the same deterministic
 *     order, so a young catalogue shows a real rail instead of an empty one.
 *
 * Nothing is fabricated here: every id returned is a published product in the
 * requested scope, the order is real order/sales data, and there is no random
 * ordering, no hardcoded id and no duplicated product list.
 */
function selectTopSellingDocumentIds(
  ranking,
  { limit = DEFAULT_BEST_SELLER_RAIL, minRailSize = MIN_BEST_SELLER_RAIL } = {},
) {
  if (!ranking.length) return [];

  const size =
    Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_BEST_SELLER_RAIL;
  const sold = ranking.filter((row) => row.totalSold > 0);
  const source = sold.length >= minRailSize ? sold : ranking;

  return source.slice(0, size).map((row) => row.documentId);
}

/** False when the scope has no sales at all, i.e. the rail is running on fill. */
function hasRecordedSales(ranking) {
  return ranking.some((row) => row.totalSold > 0);
}

async function getBestSellerDocumentIds(strapi, options = {}) {
  const ranking = await getProductSalesRanking(strapi, options);
  return selectBestSellerDocumentIds(ranking);
}

module.exports = {
  getBestSellerDocumentIds,
  getProductSalesRanking,
  selectBestSellerDocumentIds,
  selectTopSellingDocumentIds,
  hasRecordedSales,
  BEST_SELLER_BADGE_PERCENTILE,
  MIN_BEST_SELLER_RAIL,
  DEFAULT_BEST_SELLER_RAIL,
};
