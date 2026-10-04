"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

const { resolveCurrentCustomer } = require("../../../utils/current-customer");

const CART_UID = "api::cart.cart";

/**
 * Cart HTTP layer.
 *
 * Identity always comes from the JWT (see utils/current-customer.js), so
 * no endpoint accepts a cart id or customer id from the client — a
 * customer can only ever touch their own cart.
 *
 * Business rules (availability, quantity merging, pricing) live in
 * api::cart.cart's service; this layer validates shape and maps service
 * errors onto status codes.
 */

function readBody(ctx) {
  return ctx.request.body?.data ?? ctx.request.body ?? {};
}

function readTarget(body) {
  const variantId = body.variant ?? body.variantId ?? null;
  const bundleId = body.bundle ?? body.bundleId ?? null;

  return { variantId, bundleId };
}

module.exports = createCoreController(CART_UID, ({ strapi }) => ({
  async add(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);

    if (!customer) return ctx.notFound("مشتری پیدا نشد");

    const body = readBody(ctx);
    const { variantId, bundleId } = readTarget(body);
    const quantity = body.quantity ?? 1;

    if (!variantId && !bundleId) {
      return ctx.badRequest("variant یا bundle باید مشخص شود");
    }

    if (variantId && bundleId) {
      return ctx.badRequest("فقط یکی از variant یا bundle مجاز است");
    }

    try {
      const cart = bundleId
        ? await strapi
            .service(CART_UID)
            .addBundleItem(customer.documentId, bundleId, quantity)
        : await strapi
            .service(CART_UID)
            .addItem(customer.documentId, variantId, quantity);

      ctx.body = { success: true, data: cart };
    } catch (error) {
      return ctx.badRequest(error.message);
    }
  },

  async get(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);

    if (!customer) return ctx.notFound("مشتری پیدا نشد");

    const cart = await strapi.service(CART_UID).getCart(customer.documentId);

    ctx.body = { success: true, data: cart };
  },

  /** Absolute quantity update; quantity 0 removes the line. */
  async updateItem(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);

    if (!customer) return ctx.notFound("مشتری پیدا نشد");

    const body = readBody(ctx);
    const { variantId, bundleId } = readTarget(body);

    if (!variantId && !bundleId) {
      return ctx.badRequest("variant یا bundle باید مشخص شود");
    }

    if (body.quantity === undefined) {
      return ctx.badRequest("quantity الزامی است");
    }

    try {
      const cart = await strapi
        .service(CART_UID)
        .setItemQuantity(
          customer.documentId,
          { variantId, bundleId },
          body.quantity,
        );

      ctx.body = { success: true, data: cart };
    } catch (error) {
      return ctx.badRequest(error.message);
    }
  },

  async removeItem(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);

    if (!customer) return ctx.notFound("مشتری پیدا نشد");

    const body = readBody(ctx);
    const { variantId, bundleId } = readTarget(body);

    if (!variantId && !bundleId) {
      return ctx.badRequest("variant یا bundle باید مشخص شود");
    }

    try {
      const cart = await strapi
        .service(CART_UID)
        .removeItem(customer.documentId, { variantId, bundleId });

      ctx.body = { success: true, data: cart };
    } catch (error) {
      return ctx.badRequest(error.message);
    }
  },

  async clear(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);

    if (!customer) return ctx.notFound("مشتری پیدا نشد");

    const cart = await strapi.service(CART_UID).clear(customer.documentId);

    ctx.body = { success: true, data: cart };
  },

  /** One-shot guest-cart merge after login. Idempotent (max-merge). */
  async sync(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);

    if (!customer) return ctx.notFound("مشتری پیدا نشد");

    const body = readBody(ctx);
    const items = Array.isArray(body.items) ? body.items : [];

    if (items.length > 100) {
      return ctx.badRequest("تعداد آیتم‌های ارسالی بیش از حد مجاز است");
    }

    const { cart, skipped } = await strapi
      .service(CART_UID)
      .syncGuestItems(customer.documentId, items);

    ctx.body = { success: true, data: cart, skipped };
  },
}));
