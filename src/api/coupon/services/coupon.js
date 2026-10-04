"use strict";

const { createCoreService } = require("@strapi/strapi").factories;
const couponUtil = require("../../../utils/coupon");
const { getEffectivePrice } = require("../../../utils/price");

const COUPON_UID = "api::coupon.coupon";

function relationIds(values) {
  return new Set((values ?? []).map((value) => value?.documentId).filter(Boolean));
}

function restrictedSubtotal(coupon, cartItems, cartTotal) {
  const productIds = relationIds(coupon.products);
  const categoryIds = relationIds(coupon.categories);
  if (productIds.size === 0 && categoryIds.size === 0) return Number(cartTotal);

  return (cartItems ?? []).reduce((total, item) => {
    const quantity = Number(item.quantity) || 0;
    const variant = item.product_variant;
    const bundle = item.product_bundle;
    const productId = variant?.product?.documentId;
    const categoryId = variant?.product?.category?.documentId ?? bundle?.category?.documentId;
    const eligible = productIds.has(productId) || categoryIds.has(categoryId);
    if (!eligible || quantity <= 0) return total;

    const unitPrice = bundle
      ? Number(bundle.bundlePrice)
      : getEffectivePrice(variant);
    return total + unitPrice * quantity;
  }, 0);
}

module.exports = createCoreService(COUPON_UID, ({ strapi }) => ({
  async apply(code, cartTotal, { customerId = null, cartItems = [] } = {}) {
    const normalizedCode = typeof code === "string" ? code.trim().toUpperCase() : "";
    const coupon = await strapi.documents(COUPON_UID).findFirst({
      filters: { code: normalizedCode, active: true },
      populate: { customers: true, products: true, categories: true },
    });

    if (!coupon) throw new Error("کد تخفیف معتبر نیست");
    if (coupon.expiresAt && new Date(coupon.expiresAt) <= new Date()) {
      throw new Error("کد تخفیف منقضی شده");
    }
    if (Number(cartTotal) < Number(coupon.minimumOrder ?? 0)) {
      throw new Error("حداقل خرید رعایت نشده");
    }
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      throw new Error("ظرفیت کد تخفیف تمام شده");
    }

    const allowedCustomers = relationIds(coupon.customers);
    if (allowedCustomers.size > 0 && (!customerId || !allowedCustomers.has(customerId))) {
      throw new Error("این کد برای حساب شما قابل استفاده نیست");
    }

    if (coupon.oncePerCustomer && customerId) {
      const priorOrder = await strapi.documents("api::order.order").findFirst({
        filters: {
          customer: { documentId: customerId },
          coupon: { documentId: coupon.documentId },
          orderStatus: { $notIn: ["cancelled", "returned"] },
        },
        fields: ["documentId"],
      });
      if (priorOrder) throw new Error("این کد قبلاً استفاده شده است");
    }

    const eligibleTotal = restrictedSubtotal(coupon, cartItems, cartTotal);
    if (eligibleTotal <= 0) throw new Error("این کد برای اقلام سبد قابل استفاده نیست");

    const discount = couponUtil.calculate(coupon, eligibleTotal);
    return {
      couponId: coupon.documentId,
      discount,
      finalPrice: Math.max(0, Number(cartTotal) - discount),
    };
  },

  async consume(couponId) {
    const coupon = await strapi.documents(COUPON_UID).findOne({ documentId: couponId });
    if (!coupon || !coupon.active) throw new Error("کد تخفیف دیگر معتبر نیست");
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      throw new Error("ظرفیت کد تخفیف تمام شده");
    }
    return strapi.documents(COUPON_UID).update({
      documentId: coupon.documentId,
      data: { usedCount: (coupon.usedCount ?? 0) + 1 },
    });
  },

  async releaseUsage(couponId) {
    if (!couponId) return;
    const coupon = await strapi.documents(COUPON_UID).findOne({ documentId: couponId });
    if (!coupon || (coupon.usedCount ?? 0) <= 0) return;
    await strapi.documents(COUPON_UID).update({
      documentId: coupon.documentId,
      data: { usedCount: coupon.usedCount - 1 },
    });
  },
}));
