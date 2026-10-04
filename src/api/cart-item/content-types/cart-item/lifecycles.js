"use strict";

/**
 * Enforces "exactly one of product_variant / product_bundle" and keeps
 * `itemType` consistent with whichever relation is set. The rule itself
 * lives in utils/purchasable-item.js and is shared with the sibling
 * content-type, so the two can never drift apart.
 *
 * Backward compatible: callers that create rows with only
 * `{ product_variant, quantity }` (cart.service.js#addItem,
 * order.service.js#createFromCart) keep working unchanged — itemType is
 * inferred from the relation that IS present.
 */

const {
  validateExactlyOnePurchasable,
  resolveExistingPurchasableFlags,
} = require("../../../../utils/purchasable-item");

const UID = "api::cart-item.cart-item";

module.exports = {
  async beforeCreate(event) {
    validateExactlyOnePurchasable(event.params.data, {
      hasVariant: false,
      hasBundle: false,
    });
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;

    const existing = await resolveExistingPurchasableFlags(strapi, UID, where);

    validateExactlyOnePurchasable(data, existing);
  },
};
