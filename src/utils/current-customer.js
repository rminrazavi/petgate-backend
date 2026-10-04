"use strict";

const CUSTOMER_UID = "api::customer.customer";

/**
 * Resolves the Customer that belongs to the authenticated user.
 *
 * Every customer-scoped endpoint (cart, wishlist, orders) must derive
 * identity from the JWT and never from a client-supplied id — this is
 * the single place that mapping happens, so the rule can't drift
 * between controllers.
 *
 * @returns {Promise<object|null>} the Customer document, or null when
 * the request is unauthenticated or has no customer profile yet.
 */
async function resolveCurrentCustomer(strapi, ctx) {
  const user = ctx.state.user;

  if (!user) return null;

  return strapi.documents(CUSTOMER_UID).findFirst({
    filters: { users_permissions_user: { id: user.id } },
  });
}

module.exports = { resolveCurrentCustomer, CUSTOMER_UID };
