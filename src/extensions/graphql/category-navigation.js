"use strict";

const { createTtlCache } = require("../../utils/ttl-cache");

const CATEGORY_UID = "api::category.category";
const PRODUCT_UID = "api::product.product";

/**
 * `topChildCategories` — the footer's product-category list.
 *
 * Requirements it implements:
 *   - CHILD categories only (a category with at least one parent); root
 *     animal categories are excluded, since the footer is a shortcut into
 *     actual shopping categories, not a repeat of the animal picker
 *   - ranked by real popularity, highest first
 *   - hard limit (default 8, max 12) so the footer can never grow into a
 *     wall of links on mobile
 *
 * Popularity source of truth: the first-party analytics event log that
 * already exists in this project (api::analytics-event, event name
 * "category_view"). Nothing new is stored on Category, and page renders
 * are never counted server-side — only explicit client-emitted view
 * events inside a rolling window, so the ranking cannot be inflated by
 * bots hitting SSR or by a component re-rendering.
 *
 * Ties (and a catalogue with no view events yet) fall back to
 * deterministic catalogue signals: number of published products, then
 * the editor-controlled sortOrder, then name. So the footer is always
 * populated with real data and its order is stable between renders.
 */

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 12;
const VIEW_WINDOW_DAYS = 90;
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = createTtlCache({ ttlMs: CACHE_TTL_MS, maxEntries: 20 });

function clampLimit(value) {
  const n = Number.isInteger(value) ? value : DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, n));
}

/**
 * category_view counts per category reference, keyed by whatever the
 * client sent (documentId preferred, slug tolerated).
 */
async function getCategoryViewCounts(strapi) {
  try {
    const { rows } = await strapi.db.connection.raw(
      `
        SELECT
          COALESCE(
            properties->>'categoryDocumentId',
            properties->>'categoryId',
            properties->>'categorySlug'
          ) AS "reference",
          COUNT(*)::int AS "views"
        FROM analytics_events
        WHERE event_name = 'category_view'
          AND occurred_at > NOW() - (? || ' days')::interval
        GROUP BY 1
      `,
      [String(VIEW_WINDOW_DAYS)],
    );

    const counts = new Map();

    for (const row of rows) {
      if (!row.reference) continue;
      counts.set(row.reference, Number(row.views) || 0);
    }

    return counts;
  } catch (error) {
    // Popularity is a ranking signal, not a correctness requirement: if
    // the analytics table is unavailable the footer still renders from
    // catalogue signals.
    strapi.log.warn(
      `[topChildCategories] view aggregation unavailable: ${error.message}`,
    );

    return new Map();
  }
}

/**
 * Published-product counts per category documentId, resolved through the
 * relation's real join table (read from Strapi's own metadata, never a
 * hardcoded table name). Falls back to per-category counts if the
 * metadata shape is ever different.
 */
async function getPublishedProductCounts(strapi, documentIds) {
  if (documentIds.length === 0) return new Map();

  const joinTable =
    strapi.db.metadata.get(PRODUCT_UID)?.attributes?.category?.joinTable;

  if (joinTable?.name) {
    const productTable = strapi.db.metadata.get(PRODUCT_UID).tableName;
    const categoryTable = strapi.db.metadata.get(CATEGORY_UID).tableName;

    const { rows } = await strapi.db.connection.raw(
      `
        SELECT c.document_id AS "documentId", COUNT(DISTINCT p.id)::int AS "total"
        FROM ?? lnk
        JOIN ?? p ON p.id = lnk.??
        JOIN ?? c ON c.id = lnk.??
        WHERE p.published_at IS NOT NULL
          AND c.document_id = ANY(?::text[])
        GROUP BY c.document_id
      `,
      [
        joinTable.name,
        productTable,
        joinTable.joinColumn.name,
        categoryTable,
        joinTable.inverseJoinColumn.name,
        documentIds,
      ],
    );

    return new Map(rows.map((row) => [row.documentId, Number(row.total) || 0]));
  }

  const counts = await Promise.all(
    documentIds.map(async (documentId) => {
      const total = await strapi.documents(PRODUCT_UID).count({
        filters: { category: { documentId: { $eq: documentId } } },
        status: "published",
      });

      return [documentId, total];
    }),
  );

  return new Map(counts);
}

async function loadTopChildCategories(strapi, limit) {
  const categories = await strapi.documents(CATEGORY_UID).findMany({
    filters: { active: { $eq: true } },
    fields: ["name", "slug", "sortOrder"],
    populate: { parents: { fields: ["name", "slug"] } },
  });

  const children = categories.filter(
    (category) =>
      Array.isArray(category.parents) &&
      category.parents.length > 0 &&
      Boolean(category.slug),
  );

  if (children.length === 0) return [];

  const documentIds = children.map((category) => category.documentId);

  const [viewCounts, productCounts] = await Promise.all([
    getCategoryViewCounts(strapi),
    getPublishedProductCounts(strapi, documentIds),
  ]);

  return children
    .map((category) => {
      const parent = category.parents[0];

      return {
        documentId: category.documentId,
        name: category.name,
        slug: category.slug,
        parentName: parent?.name ?? null,
        parentSlug: parent?.slug ?? null,
        viewCount:
          viewCounts.get(category.documentId) ??
          viewCounts.get(category.slug) ??
          0,
        productCount: productCounts.get(category.documentId) ?? 0,
        sortOrder: category.sortOrder ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort(
      (a, b) =>
        b.viewCount - a.viewCount ||
        b.productCount - a.productCount ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name, "fa"),
    )
    .slice(0, limit)
    .map(({ sortOrder, ...category }) => category);
}

module.exports = ({ nexus, strapi }) => ({
  types: [
    nexus.objectType({
      name: "TopChildCategory",

      definition(t) {
        t.nonNull.id("documentId");
        t.nonNull.string("name");
        t.nonNull.string("slug");
        t.string("parentName");
        t.string("parentSlug");
        t.nonNull.int("viewCount");
        t.nonNull.int("productCount");
      },
    }),

    nexus.extendType({
      type: "Query",

      definition(t) {
        t.nonNull.list.nonNull.field("topChildCategories", {
          type: "TopChildCategory",

          args: { limit: nexus.intArg({ default: DEFAULT_LIMIT }) },

          resolve: async (_parent, args) => {
            const limit = clampLimit(args.limit);

            // The footer is in the root layout, so this resolves on every
            // page render: cached briefly to keep that at zero marginal
            // database cost without going stale.
            return cache.resolve(`top-child-categories:${limit}`, () =>
              loadTopChildCategories(strapi, limit),
            );
          },
        });
      },
    }),
  ],

  resolversConfig: {
    "Query.topChildCategories": { auth: false },
  },
});
