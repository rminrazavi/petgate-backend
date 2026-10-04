"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController(
  "api::product-bundle.product-bundle",

  ({ strapi }) => ({
    async findBySlug(ctx) {
      const { slug } = ctx.params;

      const bundle = await strapi
        .documents("api::product-bundle.product-bundle")
        .findFirst({
          filters: { slug },
          status: "published",
        });

      if (!bundle) {
        return ctx.notFound("باندل پیدا نشد");
      }

      const result = await strapi
        .service("api::product-bundle.product-bundle")
        .getBundleWithPricing(bundle.documentId);

      ctx.body = { success: true, data: result };
    },

    async availability(ctx) {
      const { documentId } = ctx.params;

      try {
        const result = await strapi
          .service("api::product-bundle.product-bundle")
          .getBundleAvailability(documentId);

        ctx.body = { success: true, data: result };
      } catch (err) {
        return ctx.notFound(err.message);
      }
    },
  }),
);
