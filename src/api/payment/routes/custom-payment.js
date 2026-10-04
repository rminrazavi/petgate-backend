"use strict";

module.exports = {
  routes: [
    {
      method: "POST",
      path: "/payment/request",
      handler: "payment.request",
      config: {
        auth: {},
      },
    },

    {
      method: "POST",
      path: "/payment/callback",
      handler: "payment.callback",
      config: {
        auth: false,
      },
    },

    /**
     * PHASE 6: authoritative payment/order status for the storefront's
     * payment-result page.
     *
     * The browser returning from SEP proves nothing, and the callback's
     * query/body parameters are attacker-controlled, so the result page
     * must ask the server what actually happened. No existing endpoint can
     * serve this safely: /orders/mine is a paginated list, not a
     * single-order lookup, and the payment relation it populates carries
     * provider fields that must never reach a browser.
     *
     * Authenticated + ownership-checked + whitelisted response. Safe for
     * repeated polling: it only reads.
     */
    {
      method: "GET",
      path: "/payment/status/:orderId",
      handler: "payment.status",
      config: {
        auth: {},
      },
    },
  ],
};
