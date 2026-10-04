"use strict";

/**
 * Pet routes.
 *
 * Customer-scoped, so these are explicit authenticated routes rather than a
 * core router - exactly like api::wishlist. Every handler derives the owner
 * from the JWT (utils/current-customer.js); no route accepts a customer id.
 *
 * The core CRUD router is intentionally NOT created: it would expose
 * /api/pets as generic CRUD over every customer's pets.
 */

const authenticated = { auth: { strategies: ["users-permissions"] } };

module.exports = {
  routes: [
    {
      method: "GET",
      path: "/pets/me",
      handler: "api::pet.pet.mine",
      config: authenticated,
    },
    {
      method: "POST",
      path: "/pets",
      handler: "api::pet.pet.createMine",
      config: authenticated,
    },
    {
      method: "PUT",
      path: "/pets/:documentId",
      handler: "api::pet.pet.updateMine",
      config: authenticated,
    },
    {
      method: "POST",
      path: "/pets/:documentId/photo",
      handler: "api::pet.pet.uploadPhoto",
      config: authenticated,
    },
    {
      method: "DELETE",
      path: "/pets/:documentId/photo",
      handler: "api::pet.pet.removePhoto",
      config: authenticated,
    },
    {
      method: "DELETE",
      path: "/pets/:documentId",
      handler: "api::pet.pet.deleteMine",
      config: authenticated,
    },
  ],
};
