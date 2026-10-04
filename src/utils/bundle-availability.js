"use strict";

const inventoryUtil = require("./inventory");

/**
 * Computes purchasable quantity for a bundle from its components' live
 * Inventory. Reuses utils/inventory.js#available() unmodified — no new
 * stock math, no new Inventory rows or table.
 *
 * Caller is responsible for having already reconciled expiry on each
 * component's Inventory rows (api::inventory.inventory#reconcileExpiry)
 * before calling this — same pre-condition utils/product-pricing.js
 * already has for products.
 *
 * @param {object} bundle - populated ProductBundle with `items` ->
 *   `productVariant` -> `inventories` populated.
 */
function getBundleAvailabilityFromBundle(bundle) {
  const items = Array.isArray(bundle?.items) ? bundle.items : [];

  if (!bundle?.isActive || items.length === 0) {
    return { available: false, availableQuantity: 0, components: [] };
  }

  let availableQuantity = Infinity;

  const components = items.map((item) => {
    const variant = item.productVariant;
    const requiredQuantity = Number(item.quantity) || 0;

    const inventories = Array.isArray(variant?.inventories)
      ? variant.inventories
      : [];

    const variantAvailable = inventories.reduce(
      (sum, inv) => (inv ? sum + Math.max(0, inventoryUtil.available(inv)) : sum),
      0,
    );

    const maxBundlesFromThisComponent =
      requiredQuantity > 0 ? Math.floor(variantAvailable / requiredQuantity) : 0;

    availableQuantity = Math.min(availableQuantity, maxBundlesFromThisComponent);

    return {
      variant: variant?.documentId ?? null,
      requiredQuantity,
      availableQuantity: variantAvailable,
    };
  });

  if (!Number.isFinite(availableQuantity) || availableQuantity < 0) {
    availableQuantity = 0;
  }

  return {
    available: availableQuantity > 0,
    availableQuantity,
    components,
  };
}

module.exports = { getBundleAvailabilityFromBundle };
