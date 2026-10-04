"use strict";

const bestSellersExtension = require("./extensions/graphql/best-sellers");
const productCardsExtension = require("./extensions/graphql/product-cards");
const productListExtension = require("./extensions/graphql/product-list");
const productDetailExtension = require("./extensions/graphql/product-detail");
const flashSaleExtension = require("./extensions/graphql/flash-sale");
const bundleCardsExtension = require("./extensions/graphql/bundle-cards");
const productReviewsExtension = require("./extensions/graphql/product-reviews");
const categoryNavigationExtension = require("./extensions/graphql/category-navigation");
const bannerSlotsExtension = require("./extensions/graphql/banner-slots");
const faqEntriesExtension = require("./extensions/graphql/faq-entries");
const siteTrustExtension = require("./extensions/graphql/site-trust");
const productSortGraphqlExtension = require("./extensions/graphql/product-sort-graphql");

const {
  registerProductSortGuard,
} = require("./document-middlewares/product-sort-guard");
const {
  registerProductPublishValidation,
} = require("./document-middlewares/product-publish-validation");
const {
  registerBundlePublishValidation,
} = require("./document-middlewares/bundle-publish-validation");
const { grantRolePermissions } = require("./bootstrap/permissions");
const { ensureCampaignBanners } = require("./bootstrap/campaign-banners");
const { ensureTrustSymbols } = require("./bootstrap/trust-symbols");
const { migrateTrustPromises } = require("./bootstrap/cms-foundation");

/**
 * Content-types that must never be readable or writable through the
 * auto-generated (shadow CRUD) GraphQL API.
 *
 * Everything here is either customer-private (cart, wishlist, orders,
 * addresses, payments, notifications), an authentication secret (OTP), a
 * message log (SMS), or a write-only telemetry sink (analytics events).
 * Their legitimate access paths are the authenticated REST endpoints in
 * src/api/*, which resolve identity from the JWT — none of the
 * storefront's GraphQL queries touch them.
 */
const GRAPHQL_PRIVATE_UIDS = [
  "api::otp.otp",
  "api::sms.sms",
  "api::cart.cart",
  "api::cart-item.cart-item",
  "api::order.order",
  "api::order-item.order-item",
  "api::customer.customer",
  "api::address.address",
  "api::payment.payment",
  "api::notification.notification",
  "api::wishlist.wishlist",
  "api::pet.pet",
  "api::coupon.coupon",
  "api::analytics-event.analytics-event",
];

/**
 * Content-api actions that stay disabled for the public and
 * authenticated roles.
 *
 * Order mutations must only happen through the controlled purchase flow
 * (cart -> /orders/checkout -> inventory reservation). The customer,
 * cart-item, order-item and analytics collections must not be reachable
 * as generic CRUD either: a customer would otherwise be able to read or
 * edit rows belonging to somebody else. The core routers stay in place
 * (the admin panel and the custom controllers need them); only the
 * role permissions are revoked.
 */
const LOCKED_CONTENT_API_ACTIONS = [
  "api::order.order.create",
  "api::order.order.update",
  "api::order.order.delete",
  "api::order-item.order-item.create",
  "api::order-item.order-item.update",
  "api::order-item.order-item.delete",
  "api::cart-item.cart-item.create",
  "api::cart-item.cart-item.update",
  "api::cart-item.cart-item.delete",
  "api::customer.customer.find",
  "api::customer.customer.findOne",
  "api::customer.customer.create",
  "api::customer.customer.update",
  "api::customer.customer.delete",
  "api::sms.sms.find",
  "api::sms.sms.findOne",
  // Pets are customer-private. The only access path is /pets/* in
  // src/api/pet/routes/pet.js, which derives the owner from the JWT.
  "api::pet.pet.find",
  "api::pet.pet.findOne",
  "api::pet.pet.create",
  "api::pet.pet.update",
  "api::pet.pet.delete",
];

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   */
  register({ strapi }) {
    const graphqlExtension = strapi.plugin("graphql").service("extension");

    graphqlExtension.use(bestSellersExtension);
    graphqlExtension.use(productCardsExtension);
    graphqlExtension.use(productListExtension);
    graphqlExtension.use(productDetailExtension);
    graphqlExtension.use(flashSaleExtension);
    graphqlExtension.use(bundleCardsExtension);
    graphqlExtension.use(productReviewsExtension);
    graphqlExtension.use(categoryNavigationExtension);
    graphqlExtension.use(bannerSlotsExtension);
    graphqlExtension.use(faqEntriesExtension);
    graphqlExtension.use(siteTrustExtension);

    /* Registered LAST so its resolver middleware wraps the shadow-CRUD Product
       queries after they exist. It normalises `sort` on the GraphQL ARGUMENTS,
       which is upstream of anything strapi.documents.use() can reach — see
       extensions/graphql/product-sort-graphql.js for why that layer is needed
       on top of the Document Service guard. */
    graphqlExtension.use(productSortGraphqlExtension);

    // shadowCRUD is enabled globally (config/plugins.js) so the public
    // catalogue types are generated automatically; private types are
    // removed from the schema entirely rather than left to rely on
    // per-role permissions being configured correctly.
    for (const uid of GRAPHQL_PRIVATE_UIDS) {
      graphqlExtension.shadowCRUD(uid).disable();
    }

    // Document Service middleware, not a controller override — see
    // src/document-middlewares/product-publish-validation.js for why.
    // Must be registered here (register phase), before any Document
    // Service calls (including the admin panel's own) can occur.
    //
    // The sort guard is registered FIRST so it normalises `sort` before any
    // other middleware or Strapi's own validateSort sees it. It is the
    // enforcement point for the invariant "no Product query may ever receive
    // `price` as a Product-level sort key" on the call paths this project
    // does not own (core REST find, shadow-CRUD GraphQL, admin, plugins).
    registerProductSortGuard(strapi);
    registerProductPublishValidation(strapi);
    registerBundlePublishValidation(strapi);
  },

  async bootstrap({ strapi }) {
    // Enable declared storefront actions before the deny pass.
    await grantRolePermissions(strapi);
    await lockDownContentApiActions(strapi);
    await ensureAnalyticsEventIndexes(strapi);
    await ensureOtpIndexes(strapi);
    /* Content the storefront renders from the CMS has to EXIST in the CMS.
       Both are idempotent and neither ever overwrites an editor's changes —
       see the header comment in each module. */
    await ensureCampaignBanners(strapi);
    await ensureTrustSymbols(strapi);
    await migrateTrustPromises(strapi);
  },
};

async function lockDownContentApiActions(strapi) {
  const roles = await strapi.db
    .query("plugin::users-permissions.role")
    .findMany({
      where: { type: { $in: ["public", "authenticated"] } },
    });

  for (const role of roles) {
    for (const action of LOCKED_CONTENT_API_ACTIONS) {
      // eslint-disable-next-line no-await-in-loop
      const permission = await strapi.db
        .query("plugin::users-permissions.permission")
        .findOne({
          where: { role: role.id, action },
        });

      if (permission && permission.enabled) {
        // eslint-disable-next-line no-await-in-loop
        await strapi.db.query("plugin::users-permissions.permission").update({
          where: { id: permission.id },
          data: { enabled: false },
        });

        strapi.log.info(
          `[bootstrap] Disabled ${action} for role "${role.name}"`,
        );
      }
    }
  }
}

/**
 * Adds lookup indexes to analytics_events once the table exists.
 *
 * Why this lives in bootstrap() instead of a ./database/migrations file:
 * Strapi runs database/migrations *before* it syncs content-type schemas
 * to the DB, so a migration dated "now" would run against a table that
 * doesn't exist yet on the very first deploy. bootstrap() runs after the
 * schema sync, so the table is guaranteed to exist here. Uses
 * `IF NOT EXISTS` (Postgres-only, matches this project's single DB
 * client) so it's safe to run on every boot.
 */
async function ensureAnalyticsEventIndexes(strapi) {
  await ensureIndexes(strapi, "analytics_events", [
    "CREATE INDEX IF NOT EXISTS idx_analytics_events_event_name ON analytics_events (event_name)",
    "CREATE INDEX IF NOT EXISTS idx_analytics_events_anonymous_id ON analytics_events (anonymous_id)",
    "CREATE INDEX IF NOT EXISTS idx_analytics_events_session_id ON analytics_events (session_id)",
    "CREATE INDEX IF NOT EXISTS idx_analytics_events_customer_id ON analytics_events (customer_id)",
    "CREATE INDEX IF NOT EXISTS idx_analytics_events_occurred_at ON analytics_events (occurred_at)",
    // Serves the footer's category ranking (event_name + window scan).
    "CREATE INDEX IF NOT EXISTS idx_analytics_events_name_occurred_at ON analytics_events (event_name, occurred_at)",
  ]);
}

/**
 * The OTP flow queries by phone and by ip within a time window on every
 * single login attempt, which is exactly the shape that needs an index
 * once the table has any volume.
 */
async function ensureOtpIndexes(strapi) {
  await ensureIndexes(strapi, "otps", [
    "CREATE INDEX IF NOT EXISTS idx_otps_phone_created_at ON otps (phone, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_otps_ip_created_at ON otps (ip, created_at)",
  ]);
}

async function ensureIndexes(strapi, table, statements) {
  try {
    const hasTable = await strapi.db.connection.schema.hasTable(table);
    if (!hasTable) return;

    for (const sql of statements) {
      // eslint-disable-next-line no-await-in-loop
      await strapi.db.connection.raw(sql);
    }

    strapi.log.info(`[bootstrap] Verified indexes on ${table}`);
  } catch (err) {
    // Indexing is a performance concern, not correctness — never block
    // startup over it.
    strapi.log.error(
      `[bootstrap] Failed to ensure indexes on ${table}: ${err.message}`,
    );
  }
}
