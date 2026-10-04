"use strict";

function toMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** Authoritative ProductVariant selling-price rule. */
function getEffectivePrice({ price, discountPrice = null }) {
  const regular = toMoney(price);
  if (regular === null) throw new Error("price must be a non-negative number");

  const discount =
    discountPrice === null || discountPrice === undefined
      ? null
      : toMoney(discountPrice);

  return discount !== null && discount <= regular ? discount : regular;
}

module.exports = {
  getEffectivePrice,
  calculateFinalPrice({ price, discountPrice = null, discountPercent = null }) {
    const originalPrice = toMoney(price);
    if (originalPrice === null) throw new Error("price must be a non-negative number");

    let finalPrice = getEffectivePrice({ price: originalPrice, discountPrice });
    const percent = Number(discountPercent);
    if (
      finalPrice === originalPrice &&
      Number.isFinite(percent) &&
      percent > 0 &&
      percent <= 100
    ) {
      finalPrice = originalPrice - (originalPrice * percent) / 100;
    }

    return {
      originalPrice,
      finalPrice,
      hasDiscount: finalPrice < originalPrice,
      discountAmount: originalPrice - finalPrice,
    };
  },
};
