"use strict";

const { buildUniqueSlug } = require("../../../../utils/slug");

const CAMPAIGN_UID = "api::campaign.campaign";

/** Campaigns are linkable landing pages — same shared slug strategy. */
module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;

    data.slug = await buildUniqueSlug(strapi, {
      uid: CAMPAIGN_UID,
      source: data.slug || data.title,
      fallbackPrefix: "campaign",
    });
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;

    const current = await strapi.db
      .query(CAMPAIGN_UID)
      .findOne({ where, select: ["documentId", "slug"] });

    const explicitSlug = typeof data.slug === "string" && data.slug.trim();

    if (!explicitSlug && current?.slug) {
      delete data.slug;
      return;
    }

    if (!explicitSlug && !data.title) return;

    data.slug = await buildUniqueSlug(strapi, {
      uid: CAMPAIGN_UID,
      source: explicitSlug || data.title,
      documentId: current?.documentId,
      fallbackPrefix: "campaign",
    });
  },
};
