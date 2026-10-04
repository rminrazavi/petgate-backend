"use strict";

module.exports = {
  routes: [
    {
      method: "POST",
      path: "/reviews",
      handler: "api::review.review.create",
      config: {
        auth: {},
      },
    },

    {
      method: "GET",

      path: "/reviews/product/:productId",

      handler: "api::review.review.list",

      config: {
        auth: false,
      },
    },
  ],
};
