"use strict";

const price = require("./price");
const campaign = require("./campaign");
const inventory = require("./inventory");

function computeProductPricing(product) {
  const activeCampaign = product.campaigns?.find((item) =>
    campaign.isActive(item),
  );

  const activeVariants = (product.variants || []).filter(
    (item) => item.isActive,
  );

  // PHASE 6 FIX: the selected variant must be one the customer can
  // actually buy. Selecting from product.variants (all of them) meant an
  // inactive `isDefault` variant became `selectedVariant`, so the card
  // advertised an unbuyable price and returned a documentId that is absent
  // from `variants[]` — the frontend variant selector could never match it.
  // Selection now happens over ACTIVE variants only; a product with no
  // active variant advertises no price at all.
  const variant =
    activeVariants.find((item) => item.isDefault) || activeVariants[0];

  const variants = activeVariants.map((item) => {
    const itemAttributes = Array.isArray(item.attributes)
      ? item.attributes
          .filter((a) => a && typeof a.name === "string" && typeof a.value === "string")
          .map((a) => ({ name: a.name.trim(), value: a.value.trim() }))
      : [];

    const weight = itemAttributes.find((a) => a.name === "weight")?.value;

    const flavor = itemAttributes.find((a) => a.name === "flavor")?.value;

    const variantAvailability = inventory.getAvailability([item]);

    return {
      documentId: item.documentId,
      sku: item.sku,
      weight,
      flavor,
      attributes: itemAttributes,
      price: item.price,
      discountPrice: item.discountPrice,
      isActive: item.isActive,

      // Customer-facing expiry guarantee.
      expiryGuarantee: inventory.getExpiryGuarantee(item.inventories),

      // Variant-level availability.
      availability: variantAvailability,
    };
  });

  const startingPrice = activeVariants.length
    ? Math.min(
        ...activeVariants.map((item) => {
          let effectivePrice = price.calculateFinalPrice({
            price: item.price,
            discountPrice: item.discountPrice,
          }).finalPrice;

          if (activeCampaign) {
            effectivePrice = campaign.applyDiscount(
              effectivePrice,
              activeCampaign,
            );
          }

          return effectivePrice;
        }),
      )
    : undefined;

  const availability = inventory.getAvailability(product.variants || []);

  if (!variant) {
    return {
      originalPrice: undefined,
      finalPrice: undefined,
      hasDiscount: undefined,
      discountAmount: undefined,
      selectedVariant: undefined,
      variants,
      startingPrice,
      availability,
    };
  }

  const computedPrice = price.calculateFinalPrice({
    price: variant.price,
    discountPrice: variant.discountPrice,
  });

  if (activeCampaign) {
    computedPrice.finalPrice = campaign.applyDiscount(
      computedPrice.finalPrice,
      activeCampaign,
    );

    computedPrice.hasDiscount =
      computedPrice.finalPrice < computedPrice.originalPrice;

    computedPrice.discountAmount = computedPrice.hasDiscount
      ? computedPrice.originalPrice - computedPrice.finalPrice
      : 0;
  }

  const weight = variant.attributes?.find((a) => a.name === "weight")?.value;

  const flavor = variant.attributes?.find((a) => a.name === "flavor")?.value;

  return {
    originalPrice: computedPrice.originalPrice,
    finalPrice: computedPrice.finalPrice,
    hasDiscount: computedPrice.hasDiscount,
    discountAmount: computedPrice.discountAmount,

    selectedVariant: {
      documentId: variant.documentId,
      sku: variant.sku,
      weight,
      flavor,
    },

    variants,
    startingPrice,
    availability,
  };
}

function computeProductRating(reviews) {
  const approvedReviews = reviews || [];

  if (!approvedReviews.length) {
    return {
      averageRating: 0,
      reviewCount: 0,
    };
  }

  const total = approvedReviews.reduce((sum, item) => sum + item.rating, 0);

  return {
    averageRating: Number((total / approvedReviews.length).toFixed(1)),
    reviewCount: approvedReviews.length,
  };
}

module.exports = {
  computeProductPricing,
  computeProductRating,
};
