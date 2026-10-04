"use strict";

const { getEffectivePrice } = require("./price");

/**
 * Bundle pricing.
 *
 * Pricing semantics confirmed against utils/price.js and
 * utils/product-pricing.js before writing this module:
 *
 *   - `ProductVariant.price` is the REGULAR / list price.
 *   - `ProductVariant.discountPrice`, when set, is that variant's own
 *     CURRENT SELLING price — utils/price.js#calculateFinalPrice
 *     always prefers discountPrice over price for "what a customer
 *     pays right now".
 *   - Active Campaigns (utils/campaign.js) apply a further, live,
 *     time-boxed discount on top of that, computed per-Product in
 *     utils/product-pricing.js — not stored anywhere.
 *
 * So `discountPrice ?? price` is NOT "the regular price" — it is
 * already a discounted price whenever a per-item sale is running.
 * Using it as the bundle's "regular component total" would understate
 * that total and could produce a misleadingly small (or negative)
 * bundle discount whenever a component happens to already be on sale.
 * This module tracks two separate totals instead of collapsing them
 * into one:
 *
 *   regularComponentTotal — Σ variant.price × qty (list price; this is
 *     what the task's own worked example used for every component,
 *     e.g. "Food: 1,200,000")
 *   currentComponentTotal — Σ (discountPrice ?? price) × qty (what a
 *     customer would actually pay today buying the same items
 *     separately, individual sales included)
 *
 * ...and two discount figures, so a bundle built from already-
 * discounted components never gets one number that quietly means two
 * different things:
 *
 *   discountAmount / discountPercentage
 *     — vs regularComponentTotal (list price). The headline "Save X%"
 *       figure.
 *   incrementalDiscountAmount / incrementalDiscountPercentage
 *     — vs currentComponentTotal (today's actual per-item prices). The
 *       honest "how much MORE do you save vs. buying these on sale
 *       separately right now" figure. Can be 0, or even negative if a
 *       component's own current sale price already beats the bundle —
 *       callers should treat a negative value as a signal to NOT
 *       advertise an incremental discount, not clamp/hide it silently;
 *       clamping would hide a real pricing problem from whoever set
 *       bundlePrice.
 *
 * Active per-product Campaign discounts are deliberately NOT folded
 * into either total here — those are live, time-boxed promotional
 * prices on the underlying Product, a separate concern from the
 * bundle's own fixed bundlePrice. Out of scope for this pass (see
 * final report — "future-proof for promotions" is a schema-shape
 * concern, not something to wire up now).
 *
 * No currency/rounding convention is introduced beyond what
 * utils/price.js already does (plain decimal, unrounded) — consistent
 * with the rest of the codebase.
 */

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {object} bundle - populated ProductBundle with `items` ->
 *   `productVariant` populated (price, discountPrice, sku, documentId).
 */
function computeBundlePricing(bundle) {
  const items = Array.isArray(bundle?.items) ? bundle.items : [];

  let regularComponentTotal = 0;
  let currentComponentTotal = 0;

  const components = items
    .map((item) => {
      const variant = item.productVariant;
      const quantity = toNumber(item.quantity);

      if (!variant || quantity <= 0) return null;

      const regularUnitPrice = toNumber(variant.price);
      const currentUnitPrice = getEffectivePrice(variant);

      regularComponentTotal += regularUnitPrice * quantity;
      currentComponentTotal += currentUnitPrice * quantity;

      return {
        variantId: variant.documentId,
        sku: variant.sku ?? null,
        quantity,
        regularUnitPrice,
        currentUnitPrice,
      };
    })
    .filter(Boolean);

  const bundlePrice = toNumber(bundle?.bundlePrice);

  const discountAmount = Math.max(0, regularComponentTotal - bundlePrice);
  const discountPercentage =
    regularComponentTotal > 0
      ? (discountAmount / regularComponentTotal) * 100
      : 0;

  const incrementalDiscountAmount = currentComponentTotal - bundlePrice;
  const incrementalDiscountPercentage =
    currentComponentTotal > 0
      ? (incrementalDiscountAmount / currentComponentTotal) * 100
      : 0;

  return {
    componentPriceBasis: "variant.price (regular/list price — not discountPrice)",
    regularComponentTotal,
    currentComponentTotal,
    bundlePrice,
    hasDiscount: bundlePrice < regularComponentTotal,
    discountAmount,
    discountPercentage,
    incrementalDiscountAmount,
    incrementalDiscountPercentage,
    components,
  };
}

module.exports = { computeBundlePricing };
