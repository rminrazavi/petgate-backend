"use strict";

/**
 * Role permission bootstrap.
 *
 * ROOT CAUSE THIS FIXES
 * ---------------------
 * Every users-permissions permission row is created DISABLED. Strapi only
 * enables one when a human ticks its checkbox in Settings -> Roles. On any
 * fresh database, deploy, restore or CI run that means:
 *
 *   GET  /api/auth/me         -> 403  (session dies on the next refresh,
 *                                      because the client treats 401/403 as
 *                                      a rejected token and signs out)
 *   GET  /api/customer/me     -> 403  ("profile never loads")
 *   GET  /api/pets/me         -> 403  ("pets never load")
 *   GET  /api/cart            -> 403
 *   POST /api/orders/checkout -> 403
 *   GraphQL products/articles -> empty or Forbidden
 *
 * The previous bootstrap only ever *revoked* permissions
 * (LOCKED_CONTENT_API_ACTIONS in src/index.js) and never granted the
 * public-read and owner-scoped ones, so the whole storefront depended on
 * undocumented manual admin clicks. That is the actual reason auth,
 * profile, pets, reviews and checkout looked "broken in code".
 *
 * DESIGN
 * ------
 * - Grants are declared as data, per role, applied idempotently on every
 *   boot (create-if-missing, enable-if-disabled, no-op if already enabled).
 * - Grants run BEFORE the revocations in src/index.js, so any UID present
 *   in both lists ends up revoked. Deny always wins.
 * - Only actions Strapi actually registered are written; an unknown action
 *   is skipped with a warning instead of failing the boot.
 * - Customer-private data is NEVER granted to the public role.
 */

const READ = ["find", "findOne"];

/** Content-types whose core find/findOne are legitimately public. */
const PUBLIC_READ_CONTENT_TYPES = [
  "api::product.product",
  "api::product-variant.product-variant",
  "api::product-bundle.product-bundle",
  "api::product-bundle-item.product-bundle-item",
  "api::category.category",
  "api::brand.brand",
  "api::article.article",
  "api::article-category.article-category",
  "api::banner.banner",
  "api::campaign.campaign",
  "api::faq.faq",
  "api::home-page.home-page",
  "api::menu.menu",
  "api::setting.setting",
  "api::trust-promise.trust-promise",
  "api::expert-profile.expert-profile",
  "api::footer-column.footer-column",
];

/**
 * Custom public actions (declared with `auth: false` in their route files).
 *
 * `auth: false` skips the authentication strategy, but the
 * users-permissions route policy still resolves a permission for the public
 * role, so these have to be granted explicitly.
 */
const PUBLIC_CUSTOM_ACTIONS = [
  "api::product.product.findBySlug",
  "api::product.product.search",
  "api::product.product.filter",
  "api::product-bundle.product-bundle.findBySlug",
  "api::product-bundle.product-bundle.availability",
  // Approved reviews for a product page.
  "api::review.review.list",
  // Write-only telemetry sink.
  "api::analytics-event.analytics-event.track",
  // Gateway redirect target; the gateway is not a signed-in user.
  "api::payment.payment.callback",
  // OTP sign-in / sign-up.
  "api::auth-otp.auth-otp.sendOtp",
  "api::auth-otp.auth-otp.verifyOtp",
  "api::auth-otp.auth-otp.logout",
];

/**
 * Owner-scoped actions for a signed-in customer.
 *
 * Every one derives its owner from the JWT (utils/current-customer.js) and
 * never from the request body, so granting them to the Authenticated role
 * does not let one customer reach another customer's rows. That is exactly
 * why the generic CRUD equivalents stay revoked.
 */
const AUTHENTICATED_CUSTOM_ACTIONS = [
  // Session bootstrap. Without this, /auth/me returns 403 and the client
  // signs the customer out on every page refresh.
  "api::auth-otp.auth-otp.me",

  // Profile
  "api::customer.customer.me",
  "api::customer.customer.updateMe",

  // Pet profiles
  "api::pet.pet.mine",
  "api::pet.pet.createMine",
  "api::pet.pet.updateMine",
  "api::pet.pet.deleteMine",
  "api::pet.pet.uploadPhoto",
  "api::pet.pet.removePhoto",

  // Addresses
  "api::address.address.mine",
  "api::address.address.createMine",
  "api::address.address.updateMine",
  "api::address.address.deleteMine",

  // Cart
  "api::cart.cart.get",
  "api::cart.cart.add",
  "api::cart.cart.updateItem",
  "api::cart.cart.removeItem",
  "api::cart.cart.clear",
  "api::cart.cart.sync",

  // Wishlist
  "api::wishlist.wishlist.me",
  "api::wishlist.wishlist.add",
  "api::wishlist.wishlist.toggle",
  "api::wishlist.wishlist.remove",
  "api::wishlist.wishlist.sync",

  // Notifications
  "api::notification.notification.unreadCount",

  // Orders + payment
  "api::order.order.checkout",
  "api::order.order.myOrders",
  "api::payment.payment.request",
  // Authoritative payment/order status for the payment-result page.
  "api::payment.payment.status",

  // Reviews
  "api::review.review.create",
];

function expandContentTypeReads(uids) {
  return uids.flatMap((uid) => READ.map((action) => `${uid}.${action}`));
}

function buildGrants() {
  const publicActions = [
    ...expandContentTypeReads(PUBLIC_READ_CONTENT_TYPES),
    ...PUBLIC_CUSTOM_ACTIONS,
  ];

  return {
    // The authenticated role must be able to read everything the public
    // role can, otherwise signing in would make the catalogue disappear.
    public: publicActions,
    authenticated: [...publicActions, ...AUTHENTICATED_CUSTOM_ACTIONS],
  };
}

/**
 * The action ids Strapi actually registered for the content API.
 *
 * Lets a stale entry in the lists above produce one warning instead of a
 * phantom permission row that can never match a request.
 */
function collectKnownActions(strapi) {
  const known = new Set();

  try {
    const service = strapi
      .plugin("users-permissions")
      .service("users-permissions");

    const actionMap =
      typeof service?.getActions === "function"
        ? service.getActions({ defaultEnable: false })
        : null;

    for (const [scope, section] of Object.entries(actionMap ?? {})) {
      for (const [controller, actions] of Object.entries(
        section?.controllers ?? {},
      )) {
        for (const action of Object.keys(actions ?? {})) {
          known.add(`${scope}.${controller}.${action}`);
        }
      }
    }
  } catch (error) {
    strapi.log.warn(
      `[bootstrap] Could not read the users-permissions action map: ${error.message}`,
    );
  }

  if (known.size > 0) return known;

  // Fallback: derive from the registered controllers themselves.
  for (const [uid, controller] of Object.entries(strapi.controllers ?? {})) {
    for (const action of Object.keys(controller ?? {})) {
      if (typeof controller[action] === "function") known.add(`${uid}.${action}`);
    }
  }

  // An unusable registry must not silently turn the bootstrap into a no-op:
  // returning null means "write every declared action and let the DB decide".
  return known.size > 0 ? known : null;
}

async function grantAction(strapi, role, action) {
  const query = strapi.db.query("plugin::users-permissions.permission");

  const existing = await query.findOne({ where: { role: role.id, action } });

  if (existing) {
    if (existing.enabled) return "unchanged";

    await query.update({ where: { id: existing.id }, data: { enabled: true } });

    return "enabled";
  }

  await query.create({ data: { action, role: role.id, enabled: true } });

  return "created";
}

/**
 * Enables the declared action set for the public and authenticated roles.
 * Must run BEFORE the revocation pass so deny wins on any overlap.
 */
async function grantRolePermissions(strapi) {
  const grants = buildGrants();
  const knownActions = collectKnownActions(strapi);

  const roles = await strapi.db
    .query("plugin::users-permissions.role")
    .findMany({ where: { type: { $in: ["public", "authenticated"] } } });

  if (roles.length === 0) {
    strapi.log.warn(
      "[bootstrap] No public/authenticated role found; skipping permission grants",
    );

    return;
  }

  for (const role of roles) {
    const actions = grants[role.type] ?? [];
    const summary = { created: 0, enabled: 0, unchanged: 0, skipped: 0 };

    for (const action of actions) {
      if (knownActions && !knownActions.has(action)) {
        summary.skipped += 1;

        strapi.log.warn(
          `[bootstrap] Unknown content-api action "${action}" - not granted to "${role.name}"`,
        );

        continue;
      }

      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await grantAction(strapi, role, action);

        summary[result] += 1;
      } catch (error) {
        summary.skipped += 1;

        strapi.log.error(
          `[bootstrap] Failed to grant "${action}" to "${role.name}": ${error.message}`,
        );
      }
    }

    strapi.log.info(
      `[bootstrap] Permissions for "${role.name}": ` +
        `${summary.created} created, ${summary.enabled} enabled, ` +
        `${summary.unchanged} already on, ${summary.skipped} skipped`,
    );
  }
}

module.exports = {
  grantRolePermissions,
  buildGrants,
  collectKnownActions,
  PUBLIC_READ_CONTENT_TYPES,
  PUBLIC_CUSTOM_ACTIONS,
  AUTHENTICATED_CUSTOM_ACTIONS,
};
