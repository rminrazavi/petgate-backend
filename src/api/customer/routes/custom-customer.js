"use strict";

/**
 * Customer profile routes.
 *
 * The profile page needs to READ and UPDATE the signed-in customer's own
 * record. Reading already exists (GET /auth/me returns the sanitized
 * User+Customer pair), but there was NO way to update a profile: generic
 * api::customer CRUD is deliberately disabled for both the public and
 * authenticated roles in src/index.js (LOCKED_CONTENT_API_ACTIONS),
 * because it would let any customer read or edit any other customer's row.
 *
 * This adds the one missing operation as an owner-scoped endpoint, in the
 * same style as /wishlist/* and /pets/*: identity comes from the JWT, never
 * from the request body, and only profile fields are writable.
 */

const authenticated = { auth: { strategies: ["users-permissions"] } };

module.exports = {
  routes: [
    {
      method: "GET",
      path: "/customer/me",
      handler: "api::customer.customer.me",
      config: authenticated,
    },
    {
      method: "PUT",
      path: "/customer/me",
      handler: "api::customer.customer.updateMe",
      config: authenticated,
    },
  ],
};
