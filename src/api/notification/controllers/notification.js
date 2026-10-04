"use strict";

const { createCoreController } = require("@strapi/strapi").factories;
const { resolveCurrentCustomer } = require("../../../utils/current-customer");

const UID = "api::notification.notification";

module.exports = createCoreController(UID, ({ strapi }) => ({
  async unreadCount(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);
    if (!customer) return ctx.unauthorized("ابتدا وارد شوید");

    const count = await strapi.documents(UID).count({
      filters: {
        customer: { documentId: customer.documentId },
        isRead: { $ne: true },
      },
      status: "published",
    });

    ctx.body = { success: true, data: { count } };
  },
}));
