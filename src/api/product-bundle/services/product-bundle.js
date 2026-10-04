"use strict";

const { createCoreService } = require("@strapi/strapi").factories;
const { computeBundlePricing } = require("../../../utils/bundle-price");
const {
  getBundleAvailabilityFromBundle,
} = require("../../../utils/bundle-availability");

const BUNDLE_UID = "api::product-bundle.product-bundle";

const BUNDLE_POPULATE = {
  items: {
    populate: {
      productVariant: {
        populate: { inventories: true, product: true },
      },
    },
  },
  images: true,
  category: true,
  seo: true,
};

// Any newly-expired batch must be transitioned before pricing/
// availability reads `variant.inventories` — same requirement
// api::product.product's service has for products (see reconcile
// helper there). Mutates the populated inventories in place.
async function reconcileBundleExpiry(strapi, bundle) {
  const inventoryService = strapi.service("api::inventory.inventory");

  for (const item of bundle.items || []) {
    if (item.productVariant?.inventories) {
      await inventoryService.reconcileExpiry(item.productVariant.inventories);
    }
  }

  return bundle;
}

module.exports = createCoreService(BUNDLE_UID, ({ strapi }) => ({
  /**
   * Public, customer-facing read: only ever resolves the published
   * version (same intentional fix as Product#getProductWithPrice).
   */
  async getBundleWithPricing(documentId) {
    const bundle = await strapi.documents(BUNDLE_UID).findOne({
      documentId,
      status: "published",
      populate: BUNDLE_POPULATE,
    });

    if (!bundle) return null;

    await reconcileBundleExpiry(strapi, bundle);

    return {
      bundle,
      pricing: computeBundlePricing(bundle),
      availability: getBundleAvailabilityFromBundle(bundle),
    };
  },

  /**
   * Cart/checkout availability is public purchasing behavior, so drafts are
   * never eligible even when their isActive flag is true.
   */
  async getBundleAvailability(bundleId) {
    const bundle = await strapi.documents(BUNDLE_UID).findOne({
      documentId: bundleId,
      status: "published",
      populate: BUNDLE_POPULATE,
    });

    if (!bundle) {
      throw new Error("باندل پیدا نشد");
    }

    await reconcileBundleExpiry(strapi, bundle);

    return getBundleAvailabilityFromBundle(bundle);
  },
}));
