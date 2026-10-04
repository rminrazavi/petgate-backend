"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

const { resolveCurrentCustomer } = require("../../../utils/current-customer");

/**
 * Customer-safe projection of a Payment row.
 *
 * PHASE 6 FIX: /orders/mine populated `payment: true` and assigned the raw
 * result to ctx.body, so every order response carried `cardPan` (card data),
 * `providerToken` (a live SEP token), `paymentUrl` and `refId`. Only these
 * four fields are customer-facing; everything else is dropped here rather
 * than in the frontend, because the leak is in the response itself.
 */
function sanitizePayment(payment) {
  if (!payment) return null;

  return {
    documentId: payment.documentId,
    paymentStatus: payment.paymentStatus ?? null,
    gateway: payment.gateway ?? null,
    // Bank reference number: the customer's own receipt id, not a secret.
    referenceId: payment.referenceId ?? null,
    amount: payment.amount ?? null,
    paidAt: payment.paidAt ?? null,
  };
}

function sanitizeOrder(order) {
  if (!order) return order;

  const { payment, ...rest } = order;

  return { ...rest, payment: sanitizePayment(payment) };
}

module.exports = createCoreController("api::order.order", ({ strapi }) => ({
  async checkout(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);

    if (!customer) {
      return ctx.notFound("مشتری پیدا نشد");
    }

    const body = ctx.request.body?.data ?? ctx.request.body ?? {};
    const { cartId, addressId, couponCode } = body;

    if (!cartId || !addressId) {
      return ctx.badRequest("cartId و addressId الزامی است");
    }

    try {
      const order = await strapi
        .service("api::order.order")
        .createFromCart(customer.documentId, cartId, addressId, couponCode);

      ctx.body = {
        success: true,
        data: sanitizeOrder(order),
      };
    } catch (error) {
      // Checkout failures are business-rule failures (empty cart, stock
      // gone, address not yours) — a 400 with the customer-facing reason,
      // not an opaque 500.
      return ctx.badRequest(error.message);
    }
  },

  async myOrders(ctx) {
    const user = ctx.state.user;
    const page = Math.max(1, Number.parseInt(ctx.query.page, 10) || 1);
    const pageSize = Math.min(
      50,
      Math.max(1, Number.parseInt(ctx.query.pageSize, 10) || 25),
    );

    if (!user) {
      return ctx.unauthorized();
    }

    const orders = await strapi.documents("api::order.order").findMany({
      filters: {
        customer: {
          users_permissions_user: {
            id: user.id,
          },
        },
      },

      populate: {
        order_items: {
          populate: {
            product_variant: {
              populate: {
                product: { populate: { images: true } },
              },
            },
            product_bundle: { populate: { images: true } },
            bundleSnapshot: {
              populate: { components: true },
            },
          },
        },

        address: true,

        payment: true,
      },

      sort: {
        createdAt: "desc",
      },

      start: (page - 1) * pageSize,
      limit: pageSize,
    });

    ctx.body = {
      success: true,
      data: orders.map(sanitizeOrder),
      meta: { page, pageSize },
    };
  },
}));

module.exports.__internal = { sanitizePayment, sanitizeOrder };
