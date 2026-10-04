"use strict";

module.exports = {
  routes: [
    {
      method: "GET",
      path: "/products/slug/:slug",
      handler: "api::product.product.findBySlug",
      config: {
        auth: false,
      },
    },

    {
      method: "GET",
      path: "/products/search",
      handler: "api::product.product.search",
      config: {
        auth: false,
      },
    },

    {
      method: "GET",
      path: "/products/filter",
      handler: "api::product.product.filter",
      config: {
        auth: false,
      },
    },
  ],
};
