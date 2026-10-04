"use strict";

// Reuses the single shared slug strategy — no bundle-specific slug logic.
const { buildUniqueSlug } = require("../../../../utils/slug");

const BUNDLE_UID = "api::product-bundle.product-bundle";

module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;

    data.slug = await buildUniqueSlug(strapi, {
      uid: BUNDLE_UID,
      source: data.slug || data.title,
      fallbackPrefix: "bundle",
    });
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;

    const current = await strapi.db
      .query(BUNDLE_UID)
      .findOne({ where, select: ["documentId", "slug"] });

    // Same URL-stability rule as Product: retitling never rewrites a
    // slug that already exists.
    const explicitSlug = typeof data.slug === "string" && data.slug.trim();

    if (!explicitSlug && current?.slug) {
      delete data.slug;
      return;
    }

    if (!explicitSlug && !data.title) return;

    data.slug = await buildUniqueSlug(strapi, {
      uid: BUNDLE_UID,
      source: explicitSlug || data.title,
      documentId: current?.documentId,
      fallbackPrefix: "bundle",
    });
  },
};
