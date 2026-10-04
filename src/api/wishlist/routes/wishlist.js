"use strict";

const authenticated = { auth: { strategies: ["users-permissions"] } };

module.exports = {
  routes: [
    {
      method: "GET",
      path: "/wishlist/me",
      handler: "api::wishlist.wishlist.me",
      config: authenticated,
    },
    {
      method: "POST",
      path: "/wishlist/add",
      handler: "api::wishlist.wishlist.add",
      config: authenticated,
    },
    {
      method: "POST",
      path: "/wishlist/toggle",
      handler: "api::wishlist.wishlist.toggle",
      config: authenticated,
    },
    {
      method: "DELETE",
      path: "/wishlist/remove",
      handler: "api::wishlist.wishlist.remove",
      config: authenticated,
    },
    {
      method: "POST",
      path: "/wishlist/sync",
      handler: "api::wishlist.wishlist.sync",
      config: authenticated,
    },
  ],
};
