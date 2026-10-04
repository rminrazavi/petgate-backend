"use strict";

/**
 * The Product `find` implementation, extracted from the controller.
 *
 * WHY IT IS A SEPARATE MODULE
 * ---------------------------
 * `controllers/product.js` calls `createCoreController`, which requires a
 * booted `@strapi/strapi`. That makes the controller itself unreachable from
 * a unit test, and the `ValidationError: Invalid key price` regression MUST
 * have a test that exercises the real code path rather than a copy of it.
 * Everything that decides how a price sort is answered therefore lives here,
 * and the controller is thin glue around it.
 */

const {
  rankProductIdsByPrice,
  resolveProductSort,
} = require("../../../utils/product-sort");

const PRODUCT_UID = "api::product.product";

/** A ranked order must be applied to the whole match set before paging. */
const RANKED_CANDIDATE_LIMIT = 2000;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Reads `?pagination[page]`/`[pageSize]` and the `start`/`limit` form, so the
 * ranked path pages exactly like the core `find` it wraps.
 */
function readPagination(query = {}) {
  const pagination = query?.pagination ?? {};

  const rawPageSize = Number(
    pagination.pageSize ?? pagination.limit ?? DEFAULT_PAGE_SIZE,
  );

  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.isFinite(rawPageSize) && rawPageSize > 0 ? Math.floor(rawPageSize) : DEFAULT_PAGE_SIZE),
  );

  const rawStart = Number(pagination.start);

  const page =
    pagination.start != null && Number.isFinite(rawStart) && rawStart >= 0
      ? Math.floor(rawStart / pageSize) + 1
      : Math.max(1, Math.floor(Number(pagination.page ?? 1)) || 1);

  return { page, pageSize, start: (page - 1) * pageSize };
}

/**
 * @param {object} deps
 * @param {object} deps.strapi
 * @param {object} deps.ctx                Koa context (ctx.query is rewritten in place).
 * @param {() => Promise<object>} deps.coreFind      `super.find(ctx)`.
 * @param {() => Promise<object>} deps.sanitizeQuery `this.sanitizeQuery(ctx)`.
 */
async function findProducts({ strapi, ctx, coreFind, sanitizeQuery }) {
  const resolved = resolveProductSort(ctx.query?.sort);

  if (resolved.rejected.length > 0) {
    strapi.log?.warn?.(
      `[MOPET product.find] ignored unsortable key(s) ${resolved.rejected.join(
        ", ",
      )}; ordered by ${JSON.stringify(resolved.sort)} instead.`,
    );
  }

  /* Replaced BEFORE sanitizeQuery/coreFind, so no invalid key can reach
     Strapi's validateSort in either branch below. */
  ctx.query = { ...ctx.query, sort: resolved.sort };

  if (!resolved.rank) return coreFind();

  /* Ranked path: sanitizeQuery runs only once the sort is already valid. */
  const sanitized = (await sanitizeQuery()) ?? {};
  const { page, pageSize, start } = readPagination(ctx.query);

  const candidates = await strapi.documents(PRODUCT_UID).findMany({
    filters: sanitized.filters,
    status: sanitized.status ?? "published",
    locale: sanitized.locale,
    fields: ["documentId"],
    sort: resolved.sort,
    limit: RANKED_CANDIDATE_LIMIT,
  });

  if (candidates.length === RANKED_CANDIDATE_LIMIT) {
    strapi.log?.warn?.(
      `[MOPET product.find] ranked candidate cap reached (${RANKED_CANDIDATE_LIMIT}); price order is limited to those candidates.`,
    );
  }

  const ordered = await rankProductIdsByPrice(
    strapi,
    candidates.map((item) => item.documentId),
    { rank: resolved.rank },
  );

  const total = ordered.length;
  const pageIds = ordered.slice(start, start + pageSize);

  const meta = {
    pagination: {
      page,
      pageSize,
      pageCount: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
      total,
    },
  };

  if (pageIds.length === 0) return { data: [], meta };

  /* Hydrate ONLY the current page, through the core pipeline, so response
     shape, field selection and sanitization stay exactly as before. */
  ctx.query = {
    ...ctx.query,
    filters: { documentId: { $in: pageIds } },
    pagination: { page: 1, pageSize: pageIds.length, withCount: false },
  };

  const response = (await coreFind()) ?? {};
  const position = new Map(pageIds.map((id, index) => [id, index]));

  const data = [...(response.data ?? [])].sort(
    (a, b) =>
      (position.get(a?.documentId) ?? Number.MAX_SAFE_INTEGER) -
      (position.get(b?.documentId) ?? Number.MAX_SAFE_INTEGER),
  );

  return { data, meta };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PRODUCT_UID,
  RANKED_CANDIDATE_LIMIT,
  findProducts,
  readPagination,
};
