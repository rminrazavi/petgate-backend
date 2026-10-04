"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

const CUSTOMER_UID = "api::customer.customer";
const ORDER_UID = "api::order.order";
const PAYMENT_UID = "api::payment.payment";

/**
 * Customer-facing payment status values. `paymentStatus` mirrors the
 * Payment enumeration; "cancelled" is derived (a failed payment whose
 * order was never paid and whose gateway state said cancel) and
 * "unknown" is the safe fallback the frontend renders as an error state.
 */
const CANCEL_STATES = ["-1", "cancel", "cancelled", "canceled", "false"];

async function resolveCustomer(strapi, ctx) {
  const user = ctx.state.user;

  if (!user) return null;

  return strapi.documents(CUSTOMER_UID).findFirst({
    filters: { users_permissions_user: { id: user.id } },
  });
}

module.exports = createCoreController(PAYMENT_UID, ({ strapi }) => ({
  async request(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized("ابتدا وارد شوید");
    }

    const { orderId } = ctx.request.body?.data ?? ctx.request.body ?? {};

    if (!orderId) {
      return ctx.badRequest("شناسه سفارش ارسال نشده");
    }

    // پیدا کردن Customer واقعی کاربر
    const customer = await resolveCustomer(strapi, ctx);

    if (!customer) {
      return ctx.notFound("مشتری پیدا نشد");
    }

    // گرفتن سفارش
    const order = await strapi.documents(ORDER_UID).findOne({
      documentId: orderId,
      populate: {
        customer: true,
      },
    });

    if (!order) {
      return ctx.notFound("سفارش پیدا نشد");
    }

    // بررسی مالکیت سفارش
    if (order.customer?.documentId !== customer.documentId) {
      return ctx.forbidden("این سفارش متعلق به شما نیست");
    }

    try {
      const result = await strapi.service(PAYMENT_UID).request(orderId);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      // Business failures (already paid, cancelled order, provider refused
      // to issue a token) are 400s with the Persian reason. A raw 500 with
      // a gateway string is never returned to the customer.
      strapi.log.error(
        `[payment.request] order=${orderId} failed: ${error.message}`,
      );

      return ctx.badRequest(error.message);
    }
  },

  async callback(ctx) {
    const data = { ...(ctx.query || {}), ...(ctx.request.body || {}) };
    const referenceId = data.RefNum || data.refNum;
    const resNum = data.ResNum || data.resNum;
    const status = String(data.State || data.Status || "").toLowerCase();
    const stateCode = String(data.StateCode || data.stateCode || "");

    if (!resNum) return ctx.badRequest("شناسه سفارش در پاسخ SEP وجود ندارد");

    const cancelled =
      !referenceId ||
      stateCode === "-1" ||
      CANCEL_STATES.includes(status);

    if (cancelled) {
      return finishCallback(ctx, {
        success: false,
        status: "failed",
        resNum,
      });
    }

    try {
      const result = await strapi.service(PAYMENT_UID).verify({
        referenceId,
        resNum,
      });

      return finishCallback(ctx, { success: true, data: result }, resNum);
    } catch (error) {
      // Verification failed (amount mismatch, provider error, unknown
      // RefNum). The customer must not see the provider's message; the
      // result page will read the authoritative status instead.
      strapi.log.error(
        `[payment.callback] verification failed for resNum=${resNum}: ${error.message}`,
      );

      return finishCallback(
        ctx,
        { success: false, status: "failed", resNum },
        resNum,
      );
    }
  },

  /**
   * GET /payment/status/:orderId
   *
   * Authoritative, customer-safe payment + order status. Exposes only the
   * five fields the result page and the order list need. Deliberately
   * NEVER returns: providerToken, paymentUrl, refId, cardPan, amount
   * breakdowns from the provider, SEP terminal/merchant configuration,
   * gateway payloads, or internal error text.
   */
  async status(ctx) {
    const { orderId } = ctx.params;

    if (!orderId) return ctx.badRequest("شناسه سفارش ارسال نشده");

    const customer = await resolveCustomer(strapi, ctx);

    if (!customer) return ctx.notFound("مشتری پیدا نشد");

    const order = await strapi.documents(ORDER_UID).findOne({
      documentId: orderId,
      populate: { customer: true, payment: true },
    });

    if (!order) return ctx.notFound("سفارش پیدا نشد");

    if (order.customer?.documentId !== customer.documentId) {
      return ctx.forbidden("این سفارش متعلق به شما نیست");
    }

    const payment = order.payment ?? null;

    ctx.body = {
      success: true,
      data: {
        orderId: order.documentId,
        orderNumber: order.orderNumber ?? null,
        orderStatus: order.orderStatus ?? null,
        paymentStatus: payment?.paymentStatus ?? null,
        // Bank reference (RefNum). Safe to show: it is the customer's own
        // receipt number, not a credential.
        referenceId: payment?.referenceId ?? null,
        paidAt: order.paidAt ?? payment?.paidAt ?? null,
        finalPrice: order.finalPrice ?? null,
      },
    };
  },
}));

/**
 * SEP POSTs the CUSTOMER'S BROWSER to the callback URL, so the response
 * body would be rendered as a page. When a frontend result route is
 * configured the browser is redirected there with nothing but a
 * non-authoritative order reference; the result page then calls
 * /payment/status/:orderId for the real outcome.
 *
 * Without FRONTEND_PAYMENT_RESULT_URL the previous JSON body is kept so
 * existing server-to-server integrations and tests do not change.
 */
function finishCallback(ctx, body, resNum) {
  const target = process.env.FRONTEND_PAYMENT_RESULT_URL;

  if (!target) {
    ctx.body = body;
    return ctx.body;
  }

  const reference = resNum || body?.resNum || "";
  const separator = target.includes("?") ? "&" : "?";
  const url = reference
    ? `${target}${separator}orderId=${encodeURIComponent(reference)}`
    : target;

  ctx.redirect(url);
  return undefined;
}

module.exports.__internal = { finishCallback, CANCEL_STATES };
