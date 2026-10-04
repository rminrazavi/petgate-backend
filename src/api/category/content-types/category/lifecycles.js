"use strict";

const { buildUniqueSlug } = require("../../../../utils/slug");
const { extractRelationRef } = require("../../../../utils/relation-input");

const CATEGORY_UID = "api::category.category";

/**
 * A Category is publicly routable (/category/:slug) and is the animal /
 * taxonomy source of truth, so it gets the same automatic, Persian-aware
 * slug treatment as Product — previously slugs had to be typed by hand
 * here, which is how blank and duplicate category slugs got in.
 */
module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;

    guardSelfParent(data, null);

    data.slug = await buildUniqueSlug(strapi, {
      uid: CATEGORY_UID,
      source: data.slug || data.name,
      fallbackPrefix: "category",
    });
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;

    const current = await strapi.db
      .query(CATEGORY_UID)
      .findOne({ where, select: ["id", "documentId", "slug"] });

    guardSelfParent(data, current);

    const explicitSlug = typeof data.slug === "string" && data.slug.trim();

    if (!explicitSlug && current?.slug) {
      delete data.slug;
      return;
    }

    if (!explicitSlug && !data.name) return;

    data.slug = await buildUniqueSlug(strapi, {
      uid: CATEGORY_UID,
      source: explicitSlug || data.name,
      documentId: current?.documentId,
      fallbackPrefix: "category",
    });
  },
};

/**
 * `parents`/`children` is a self-referential relation with no database
 * level cycle guard. A category that is its own parent makes the
 * descendant walk in utils/category-tree.js loop over itself forever
 * (it terminates on the visited-set, but the tree is nonsense), so the
 * cheap, unambiguous case is rejected at write time.
 */
function guardSelfParent(data, current) {
  if (!current) return;

  const parents = data.parents;

  if (!parents) return;

  const refs = Array.isArray(parents)
    ? parents
    : (parents.connect ?? parents.set ?? []);

  for (const ref of Array.isArray(refs) ? refs : [refs]) {
    const value = extractRelationRef(ref);

    if (value === null) continue;

    const matchesSelf =
      String(value) === String(current.documentId) ||
      String(value) === String(current.id);

    if (matchesSelf) {
      throw new Error("A category cannot be its own parent");
    }
  }
}
