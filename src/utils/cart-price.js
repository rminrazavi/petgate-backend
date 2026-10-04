"use strict";

const { getEffectivePrice } = require("./price");

/**
 * Cart totals.
 *
 * Prices always come from live relations (variant.discountPrice ??
 * variant.price, bundle.bundlePrice) — never from the client and never
 * from the stored CartItem.price column, so a price change is picked up
 * on the next recalculation.
 */

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

module.exports = {
  calculate(cartItems = []) {
    let totalPrice = 0;
    let totalItems = 0;

    const items = (Array.isArray(cartItems) ? cartItems : [])
      .map((item) => {
        const quantity = Math.max(0, Math.trunc(toNumber(item?.quantity) || 0));

        if (quantity === 0) return null;

        if (item.product_bundle) {
          const bundle = item.product_bundle;
          const price = toNumber(bundle.bundlePrice);
          const subtotal = price * quantity;

          totalPrice += subtotal;
          totalItems += quantity;

          return {
            itemType: "bundle",
            bundle: bundle.documentId,
            title: bundle.title ?? null,
            price,
            quantity,
            subtotal,
          };
        }

        const variant = item.product_variant;

        if (!variant) return null;

        const price = getEffectivePrice(variant);
        const subtotal = price * quantity;

        totalPrice += subtotal;
        totalItems += quantity;

        return {
          itemType: "variant",
          variant: variant.documentId,
          sku: variant.sku ?? null,
          price,
          quantity,
          subtotal,
        };
      })
      .filter(Boolean);

    return {
      items,
      totalItems,
      totalPrice,
      discount: 0,
      finalPrice: totalPrice,
    };
  },
};
