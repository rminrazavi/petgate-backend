"use strict";

const { createCoreService } = require("@strapi/strapi").factories;

module.exports = createCoreService(
  "api::product-variant.product-variant",
  ({ strapi }) => ({
    async getDefaultVariant(productDocumentId) {
      const variants = await strapi
        .documents("api::product-variant.product-variant")
        .findMany({
          filters: {
            product: {
              documentId: productDocumentId,
            },
          },
          sort: ["isDefault:desc", "createdAt:asc"],
        });

      if (!variants.length) {
        return null;
      }

      return variants[0];
    },
  }),
);
