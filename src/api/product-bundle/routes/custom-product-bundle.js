"use strict";

module.exports = {
  routes: [
    {
      method: "GET",
      path: "/product-bundles/slug/:slug",
      handler: "api::product-bundle.product-bundle.findBySlug",
      config: {
        auth: false,
      },
    },
    {
      method: "GET",
      path: "/product-bundles/:documentId/availability",
      handler: "api::product-bundle.product-bundle.availability",
      config: {
        auth: false,
      },
    },
  ],
};
