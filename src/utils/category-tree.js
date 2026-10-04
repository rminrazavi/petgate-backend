"use strict";

const CATEGORY_UID = "api::category.category";

/**
 * Loads one hierarchy level at a time. A level is fetched in one query,
 * so a wide tree does not turn into one query per category. `visited`
 * protects malformed cyclic trees and also de-duplicates shared children.
 *
 * `cache` is request/extension scoped by the caller. The utility deliberately
 * owns no global cache, which avoids serving stale category trees forever.
 */
async function getDescendantCategoryIds(
  strapi,
  rootCategoryDocumentId,
  { includeRoot = true, cache = null } = {},
) {
  if (!rootCategoryDocumentId) return [];

  const cacheKey = `${rootCategoryDocumentId}:${includeRoot}`;

  const load = async () => {
    const visited = new Set();
    let pending = [rootCategoryDocumentId];
    let rootFound = false;

    while (pending.length > 0) {
      const levelIds = [...new Set(pending)].filter((id) => !visited.has(id));
      if (levelIds.length === 0) break;

      const categories = await strapi.documents(CATEGORY_UID).findMany({
        filters: { documentId: { $in: levelIds } },
        fields: ["name", "slug"],
        populate: { children: { fields: ["name"] } },
      });

      if (!rootFound) {
        rootFound = categories.some(
          (category) => category.documentId === rootCategoryDocumentId,
        );
      }

      pending = [];

      for (const category of categories) {
        if (!category?.documentId || visited.has(category.documentId)) continue;

        visited.add(category.documentId);

        for (const child of category.children || []) {
          if (child?.documentId && !visited.has(child.documentId)) {
            pending.push(child.documentId);
          }
        }
      }
    }

    if (!rootFound) return [];
    if (!includeRoot) visited.delete(rootCategoryDocumentId);

    return [...visited];
  };

  // `cache` is a utils/ttl-cache.js instance supplied by the caller. The
  // utility owns no global cache of its own, so nothing can serve a stale
  // category tree for the lifetime of the process.
  const ids = cache ? await cache.resolve(cacheKey, load) : await load();

  return [...ids];
}

module.exports = { getDescendantCategoryIds };
