"use strict";

const { createCoreService } = require("@strapi/strapi").factories;

const cartPrice = require("../../../utils/cart-price");

const CART_UID = "api::cart.cart";
const CART_ITEM_UID = "api::cart-item.cart-item";
const VARIANT_UID = "api::product-variant.product-variant";
const BUNDLE_UID = "api::product-bundle.product-bundle";

/**
 * Cart service.
 *
 * Architecture (unchanged): Cart belongs to Customer, CartItem points at
 * a ProductVariant (the sellable unit) or a ProductBundle — never at a
 * Product. Every method below is keyed by `customerId`, so a cart can
 * only ever be read or mutated through its owner; there is no code path
 * that takes a cart id from the client.
 *
 * Pricing is always recomputed from live variant/bundle data by
 * utils/cart-price.js — a client-supplied price is never trusted or
 * stored.
 */

const CART_ITEM_POPULATE = {
  cart_items: {
    populate: {
      product_variant: {
        populate: {
          product: { populate: { images: true } },
          attributes: true,
        },
      },
      product_bundle: {
        populate: {
          images: true,
          items: {
            populate: { productVariant: { populate: { product: true } } },
          },
        },
      },
    },
  },
};

function normalizeQuantity(value, { allowZero = false } = {}) {
  const quantity = Number(value);

  if (!Number.isInteger(quantity)) {
    throw new Error("تعداد نامعتبر است");
  }

  if (quantity < (allowZero ? 0 : 1)) {
    throw new Error("تعداد باید حداقل یک عدد باشد");
  }

  return quantity;
}

module.exports = createCoreService(CART_UID, ({ strapi }) => ({
  /** Sellable quantity for a variant across every inventory batch. */
  async getVariantAvailableQuantity(variantId) {
    const batches = await strapi
      .service("api::inventory.inventory")
      .getSellableBatches(variantId);

    if (!batches.length) return null; // no inventory row at all

    return batches.reduce(
      (sum, row) => sum + Math.max(0, (row.stock ?? 0) - (row.reserved ?? 0)),
      0,
    );
  },

  async getOrCreateCart(customerId) {
    const existing = await strapi.documents(CART_UID).findFirst({
      filters: { customer: { documentId: customerId } },
      populate: CART_ITEM_POPULATE,
    });

    if (existing) return existing;

    return strapi.documents(CART_UID).create({
      data: {
        customer: customerId,
        totalPrice: 0,
        discount: 0,
        finalPrice: 0,
        totalItems: 0,
      },
      populate: CART_ITEM_POPULATE,
    });
  },

  async getCart(customerId) {
    return strapi.documents(CART_UID).findFirst({
      filters: { customer: { documentId: customerId } },
      populate: { ...CART_ITEM_POPULATE, customer: true },
    });
  },

  async addItem(customerId, variantId, quantity = 1) {
    const requested = normalizeQuantity(quantity);

    const variant = await strapi.documents(VARIANT_UID).findOne({
      documentId: variantId,
    });

    if (!variant) throw new Error("محصول پیدا نشد");
    if (!variant.isActive) throw new Error("این محصول در دسترس نیست");

    const available = await this.getVariantAvailableQuantity(variantId);

    if (available === null) throw new Error("موجودی محصول پیدا نشد");

    const cart = await this.getOrCreateCart(customerId);

    const existingItem = cart.cart_items?.find(
      (item) => item.product_variant?.documentId === variantId,
    );

    const nextQuantity = (existingItem?.quantity ?? 0) + requested;

    if (available < nextQuantity) throw new Error("موجودی کافی نیست");

    if (existingItem) {
      await strapi.documents(CART_ITEM_UID).update({
        documentId: existingItem.documentId,
        data: { quantity: nextQuantity },
      });
    } else {
      await strapi.documents(CART_ITEM_UID).create({
        data: {
          cart: cart.documentId,
          product_variant: variantId,
          quantity: requested,
        },
      });
    }

    return this.recalculate(cart.documentId);
  },

  /**
   * Bundle counterpart of addItem(). Availability comes from the bundle
   * service (component-derived), never from a single Inventory row.
   */
  async addBundleItem(customerId, bundleId, quantity = 1) {
    const requested = normalizeQuantity(quantity);

    const bundle = await strapi.documents(BUNDLE_UID).findOne({
      documentId: bundleId,
      status: "published",
    });

    if (!bundle) throw new Error("باندل پیدا نشد");
    if (!bundle.isActive) throw new Error("این باندل در دسترس نیست");

    const availability = await strapi
      .service(BUNDLE_UID)
      .getBundleAvailability(bundleId);

    const cart = await this.getOrCreateCart(customerId);

    const existingItem = cart.cart_items?.find(
      (item) => item.product_bundle?.documentId === bundleId,
    );

    const nextQuantity = (existingItem?.quantity ?? 0) + requested;

    if (availability.availableQuantity < nextQuantity) {
      throw new Error("موجودی کافی نیست");
    }

    if (existingItem) {
      await strapi.documents(CART_ITEM_UID).update({
        documentId: existingItem.documentId,
        data: { quantity: nextQuantity },
      });
    } else {
      await strapi.documents(CART_ITEM_UID).create({
        data: {
          cart: cart.documentId,
          product_bundle: bundleId,
          quantity: requested,
        },
      });
    }

    return this.recalculate(cart.documentId);
  },

  /**
   * Absolute quantity set (not a delta), so a retried request can never
   * double-count. Quantity 0 removes the line.
   */
  async setItemQuantity(customerId, { variantId, bundleId }, quantity) {
    const requested = normalizeQuantity(quantity, { allowZero: true });

    if (!variantId && !bundleId) throw new Error("آیتم مشخص نشده است");

    const cart = await this.getOrCreateCart(customerId);

    const item = cart.cart_items?.find((entry) =>
      bundleId
        ? entry.product_bundle?.documentId === bundleId
        : entry.product_variant?.documentId === variantId,
    );

    if (!item) throw new Error("این آیتم در سبد وجود ندارد");

    if (requested === 0) {
      await strapi.documents(CART_ITEM_UID).delete({
        documentId: item.documentId,
      });

      return this.recalculate(cart.documentId);
    }

    const available = bundleId
      ? (await strapi.service(BUNDLE_UID).getBundleAvailability(bundleId))
          .availableQuantity
      : await this.getVariantAvailableQuantity(variantId);

    if (available === null) throw new Error("موجودی محصول پیدا نشد");
    if (available < requested) throw new Error("موجودی کافی نیست");

    await strapi.documents(CART_ITEM_UID).update({
      documentId: item.documentId,
      data: { quantity: requested },
    });

    return this.recalculate(cart.documentId);
  },

  async removeItem(customerId, { variantId, bundleId }) {
    return this.setItemQuantity(customerId, { variantId, bundleId }, 0);
  },

  async clear(customerId) {
    const cart = await this.getOrCreateCart(customerId);

    for (const item of cart.cart_items ?? []) {
      // eslint-disable-next-line no-await-in-loop
      await strapi.documents(CART_ITEM_UID).delete({
        documentId: item.documentId,
      });
    }

    return this.recalculate(cart.documentId);
  },

  /**
   * Guest cart -> server cart merge, run once on login.
   *
   * Deterministic and idempotent: the resulting quantity for a line is
   * max(server, guest), never server + guest. Re-running the same sync
   * (double submit, retry, second tab) therefore cannot inflate the
   * cart. Lines that exceed live availability are clamped, and items
   * that no longer exist are skipped rather than failing the whole
   * merge — one stale localStorage entry must not block login.
   */
  async syncGuestItems(customerId, items = []) {
    const cart = await this.getOrCreateCart(customerId);

    const skipped = [];

    for (const raw of Array.isArray(items) ? items : []) {
      const quantity = Number(raw?.quantity);

      if (!Number.isInteger(quantity) || quantity < 1) {
        skipped.push({ item: raw, reason: "INVALID_QUANTITY" });
        continue;
      }

      const isBundle = raw?.itemType === "bundle" || Boolean(raw?.bundleId);
      const variantId = raw?.variantId ?? null;
      const bundleId = raw?.bundleId ?? null;

      if (isBundle ? !bundleId : !variantId) {
        skipped.push({ item: raw, reason: "MISSING_REFERENCE" });
        continue;
      }

      try {
        const existing = cart.cart_items?.find((entry) =>
          isBundle
            ? entry.product_bundle?.documentId === bundleId
            : entry.product_variant?.documentId === variantId,
        );

        const target = Math.max(existing?.quantity ?? 0, quantity);

        if (existing) {
          if (target !== existing.quantity) {
            // eslint-disable-next-line no-await-in-loop
            await this.setItemQuantity(
              customerId,
              { variantId, bundleId },
              target,
            );
          }
        } else if (isBundle) {
          // eslint-disable-next-line no-await-in-loop
          await this.addBundleItem(customerId, bundleId, target);
        } else {
          // eslint-disable-next-line no-await-in-loop
          await this.addItem(customerId, variantId, target);
        }
      } catch (error) {
        skipped.push({ item: raw, reason: error.message });
      }
    }

    const merged = await this.recalculate(cart.documentId);

    return { cart: merged, skipped };
  },

  async recalculate(cartId) {
    const cart = await strapi.documents(CART_UID).findOne({
      documentId: cartId,
      populate: CART_ITEM_POPULATE,
    });

    if (!cart) return null;

    const result = cartPrice.calculate(cart.cart_items);

    await strapi.documents(CART_UID).update({
      documentId: cart.documentId,
      data: {
        totalPrice: result.totalPrice,
        discount: result.discount ?? 0,
        finalPrice: result.finalPrice ?? result.totalPrice,
        totalItems: result.totalItems,
      },
    });

    return strapi.documents(CART_UID).findOne({
      documentId: cart.documentId,
      populate: { ...CART_ITEM_POPULATE, customer: true },
    });
  },
}));
