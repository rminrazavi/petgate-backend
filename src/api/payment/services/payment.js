"use strict";

const { createCoreService } = require("@strapi/strapi").factories;

const PaymentGatewayFactory = require("./factories/payment-gateway-factory");
const STATUS = require("./helpers/payment-status");

module.exports = createCoreService("api::payment.payment", ({ strapi }) => ({
  /**
   * Idempotent payment request: if an order has a pending payment,
   * return it instead of creating a duplicate.
   * 
   * The SEP token is reused for a pending order so retries do not create
   * another provider transaction.
   */
  async request(orderId) {
    const order = await strapi.documents("api::order.order").findOne({
      documentId: orderId,
    });

    if (!order) {
      throw new Error("سفارش پیدا نشد");
    }

    if (order.orderStatus === "paid") throw new Error("این سفارش قبلا پرداخت شده است");
    if (["cancelled", "returned"].includes(order.orderStatus)) throw new Error("امکان پرداخت این سفارش وجود ندارد");

    // Idempotency: reuse an existing pending SEP token.
    const existingPayment = await strapi
      .documents("api::payment.payment")
      .findFirst({
        filters: {
          order: orderId,
          paymentStatus: STATUS.PENDING,
        },
      });

    if (existingPayment && existingPayment.providerToken && existingPayment.paymentUrl) {
      return {
        providerToken: existingPayment.providerToken,
        url: existingPayment.paymentUrl,
        method: "POST",
        fields: { Token: existingPayment.providerToken },
        resNum: existingPayment.resNum || order.documentId,
        existing: true,
      };
    }

    // No pending payment exists: create a new SEP token.
    const gateway = PaymentGatewayFactory.create("sep");
    const callbackURL = process.env.SEP_CALLBACK_URL;
    if (!callbackURL) throw new Error("SEP_CALLBACK_URL is not configured");

    const payment = await strapi.documents("api::payment.payment").create({
      data: {
        order: orderId,
        amount: order.finalPrice,
        paymentStatus: STATUS.PENDING,
        gateway: "sep",
      },
    });

    let result;
    try {
      result = await gateway.requestPayment({
        amount: order.finalPrice,
        orderId: order.documentId,
        callbackURL,
      });
    } catch (error) {
      await strapi.documents("api::payment.payment").update({
        documentId: payment.documentId,
        data: { paymentStatus: STATUS.FAILED },
      });
      throw error;
    }

    await strapi.documents("api::payment.payment").update({
      documentId: payment.documentId,
      data: {
        providerToken: result.providerToken,
        resNum: result.resNum,
        paymentUrl: result.url,
        paymentStatus: STATUS.PENDING,
        gateway: "sep",
      },
    });

    await strapi.documents("api::order.order").update({
      documentId: order.documentId,
      data: { orderStatus: "waiting_payment" },
    });

    return result;
  },

  /**
   * Idempotent payment verification.
   * 
   * CRITICAL: If a payment has already been marked SUCCESS, return the
   * existing successful state without re-verifying or re-confirming the
   * order (which would be a duplicate). The payment state alone determines
   * order state: if payment=success, order=paid (set by the initial verify
   * callback). Repeated callbacks must not cause repeated confirmations.
   */
  async verify({ referenceId, resNum }) {
    const payment = await strapi.documents("api::payment.payment").findFirst({
      filters: {
        ...(resNum ? { resNum } : { referenceId }),
      },

      populate: {
        order: true,
      },
    });

    if (!payment) {
      throw new Error("پرداخت پیدا نشد");
    }

    // Idempotency: if already verified successful, return without re-verifying
    if (payment.paymentStatus === STATUS.SUCCESS) {
      return {
        referenceId: payment.referenceId,
        // Signal: this verification already completed
        verified: true,
      };
    }

    // First verification: call gateway and confirm order
    const gateway = PaymentGatewayFactory.create("sep");

    const result = await gateway.verifyPayment({
      referenceId,
      amount: payment.amount,
    });

    // Keep payment, order and inventory consistent. The old ordering marked
    // payment successful before inventory committed, making retries return early.
    await strapi.db.transaction(async () => {
      await strapi
        .service("api::order.order")
        .confirmPayment(payment.order.documentId);

      await strapi.documents("api::payment.payment").update({
        documentId: payment.documentId,
        data: {
          paymentStatus: STATUS.SUCCESS,
          referenceId: result.referenceId,
          paidAt: new Date(),
        },
      });
    });

    return result;
  },
}));
