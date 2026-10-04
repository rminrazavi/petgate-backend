"use strict";

const { buildUniqueSlug } = require("../../../../utils/slug");

const PRODUCT_UID = "api::product.product";

module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;

    data.slug = await buildUniqueSlug(strapi, {
      uid: PRODUCT_UID,
      source: data.slug || data.name,
      fallbackPrefix: "product",
    });
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;

    const current = await strapi.db
      .query(PRODUCT_UID)
      .findOne({ where, select: ["documentId", "slug"] });

    // A published product's slug is its public URL: renaming the product
    // must NOT silently change (and break) that URL. The slug is only
    // (re)generated when an editor explicitly sends a new one, or when
    // the row has no slug yet.
    const explicitSlug = typeof data.slug === "string" && data.slug.trim();

    if (!explicitSlug && current?.slug) {
      delete data.slug;
      return;
    }

    if (!explicitSlug && !data.name) return;

    data.slug = await buildUniqueSlug(strapi, {
      uid: PRODUCT_UID,
      source: explicitSlug || data.name,
      documentId: current?.documentId,
      fallbackPrefix: "product",
    });
  },
};
