"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

const { resolveCurrentCustomer } = require("../../../utils/current-customer");

const WISHLIST_UID = "api::wishlist.wishlist";

/**
 * Wishlist HTTP layer. Ownership is derived from the JWT for every
 * action (see utils/current-customer.js) — a customer can never read or
 * mutate another customer's wishlist.
 */

function readProductId(ctx) {
  const body = ctx.request.body?.data ?? ctx.request.body ?? {};

  return body.productId ?? body.product ?? null;
}

module.exports = createCoreController(WISHLIST_UID, ({ strapi }) => ({
  async me(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);

    if (!customer) return ctx.notFound("مشتری پیدا نشد");

    ctx.body = {
      success: true,
      data: await strapi.service(WISHLIST_UID).get(customer.documentId),
    };
  },

  async add(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);

    if (!customer) return ctx.notFound("مشتری پیدا نشد");

    const productId = readProductId(ctx);

    if (!productId) return ctx.badRequest("شناسه محصول ارسال نشده");

    try {
      ctx.body = {
        success: true,
        data: await strapi
          .service(WISHLIST_UID)
          .add(customer.documentId, productId),
      };
    } catch (error) {
      return ctx.badRequest(error.message);
    }
  },

  async remove(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);

    if (!customer) return ctx.notFound("مشتری پیدا نشد");

    const productId = readProductId(ctx);

    if (!productId) return ctx.badRequest("شناسه محصول ارسال نشده");

    ctx.body = {
      success: true,
      data: await strapi
        .service(WISHLIST_UID)
        .remove(customer.documentId, productId),
    };
  },

  async toggle(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);

    if (!customer) return ctx.notFound("مشتری پیدا نشد");

    const productId = readProductId(ctx);

    if (!productId) return ctx.badRequest("شناسه محصول ارسال نشده");

    try {
      const { wishlisted, wishlist } = await strapi
        .service(WISHLIST_UID)
        .toggle(customer.documentId, productId);

      ctx.body = { success: true, wishlisted, data: wishlist };
    } catch (error) {
      return ctx.badRequest(error.message);
    }
  },

  async sync(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);

    if (!customer) return ctx.notFound("مشتری پیدا نشد");

    const body = ctx.request.body?.data ?? ctx.request.body ?? {};

    const { wishlist, skipped } = await strapi
      .service(WISHLIST_UID)
      .syncGuestProducts(customer.documentId, body.productIds);

    ctx.body = { success: true, data: wishlist, skipped };
  },
}));
