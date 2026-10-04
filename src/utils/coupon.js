"use strict";

/**
 * Coupon calculation with safety guardrails.
 * 
 * CRITICAL: discount must never exceed cartTotal, resulting in a negative
 * finalPrice. Two-stage clamp:
 * 1. Apply discount calculation
 * 2. Cap discount at cartTotal
 */

module.exports = {
  calculate(coupon, total) {
    if (!coupon || !Number.isFinite(total) || total < 0) {
      return 0;
    }

    let discount = 0;

    if (coupon.type === "percent") {
      discount = (total * coupon.value) / 100;

      // Cap percentage discount if maxDiscount set
      if (coupon.maxDiscount && discount > coupon.maxDiscount) {
        discount = coupon.maxDiscount;
      }
    } else if (coupon.type === "fixed") {
      discount = coupon.value ?? 0;
    }

    // SAFETY: clamp discount to cartTotal so finalPrice is never negative
    discount = Math.min(discount, total);
    discount = Math.max(0, discount);

    return discount;
  },
};
