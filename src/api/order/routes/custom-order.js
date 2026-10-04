"use strict";

module.exports = {
  routes: [
    {
      method: "POST",
      path: "/orders/checkout",
      handler: "order.checkout",
      config: {
        auth: {},
      },
    },
    {
      method: "GET",
      path: "/orders/mine",
      handler: "order.myOrders",
      config: {
        auth: {},
      },
    },
  ],
};
