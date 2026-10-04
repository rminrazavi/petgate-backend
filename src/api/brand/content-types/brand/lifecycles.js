"use strict";

const { buildUniqueSlug } = require("../../../../utils/slug");

const BRAND_UID = "api::brand.brand";

/** Brands are publicly routable (/brand/:slug) — same slug rules as Product. */
module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;

    data.slug = await buildUniqueSlug(strapi, {
      uid: BRAND_UID,
      source: data.slug || data.name,
      fallbackPrefix: "brand",
    });
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;

    const current = await strapi.db
      .query(BRAND_UID)
      .findOne({ where, select: ["documentId", "slug"] });

    const explicitSlug = typeof data.slug === "string" && data.slug.trim();

    if (!explicitSlug && current?.slug) {
      delete data.slug;
      return;
    }

    if (!explicitSlug && !data.name) return;

    data.slug = await buildUniqueSlug(strapi, {
      uid: BRAND_UID,
      source: explicitSlug || data.name,
      documentId: current?.documentId,
      fallbackPrefix: "brand",
    });
  },
};
