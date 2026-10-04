"use strict";

/**
 * Every cart route requires authentication: the cart is resolved from
 * the JWT's customer, never from a client-supplied identifier.
 */
const authenticated = { auth: {} };

module.exports = {
  routes: [
    {
      method: "GET",
      path: "/cart",
      handler: "cart.get",
      config: authenticated,
    },
    {
      method: "POST",
      path: "/cart/add",
      handler: "cart.add",
      config: authenticated,
    },
    {
      method: "PUT",
      path: "/cart/item",
      handler: "cart.updateItem",
      config: authenticated,
    },
    {
      method: "DELETE",
      path: "/cart/item",
      handler: "cart.removeItem",
      config: authenticated,
    },
    {
      method: "DELETE",
      path: "/cart",
      handler: "cart.clear",
      config: authenticated,
    },
    {
      method: "POST",
      path: "/cart/sync",
      handler: "cart.sync",
      config: authenticated,
    },
  ],
};
