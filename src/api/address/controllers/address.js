"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController("api::address.address", ({ strapi }) => ({
  async mine(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized("ابتدا وارد شوید");
    }

    const customer = await strapi
      .documents("api::customer.customer")
      .findFirst({
        filters: {
          users_permissions_user: {
            id: user.id,
          },
        },
      });

    if (!customer) {
      return ctx.notFound("مشتری پیدا نشد");
    }

    const addresses = await strapi.documents("api::address.address").findMany({
      filters: {
        customer: {
          documentId: customer.documentId,
        },
      },
      sort: {
        createdAt: "desc",
      },
    });

    return {
      success: true,
      data: addresses,
    };
  },

  async createMine(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized("ابتدا وارد شوید");
    }

    const customer = await strapi
      .documents("api::customer.customer")
      .findFirst({
        filters: {
          users_permissions_user: {
            id: user.id,
          },
        },
      });

    if (!customer) {
      return ctx.notFound("مشتری پیدا نشد");
    }

    const bodyData = ctx.request.body?.data || ctx.request.body || {};

    // If marked as default, unset others first
    if (bodyData.isDefault) {
      const existing = await strapi.documents("api::address.address").findMany({
        filters: {
          customer: { documentId: customer.documentId },
          isDefault: true,
        },
      });
      for (const item of existing) {
        await strapi.documents("api::address.address").update({
          documentId: item.documentId,
          data: { isDefault: false },
        });
      }
    }

    // If this is the customer's first address, make it default automatically
    const count = await strapi.documents("api::address.address").count({
      filters: { customer: { documentId: customer.documentId } },
    });

    const isFirst = count === 0;

    let addressBlocks = bodyData.address;
    if (typeof bodyData.address === "string") {
      addressBlocks = [
        {
          type: "paragraph",
          children: [{ type: "text", text: bodyData.address }],
        },
      ];
    }

    const created = await strapi.documents("api::address.address").create({
      data: {
        title: bodyData.title,
        receiverName: bodyData.receiverName,
        receiverPhone: bodyData.receiverPhone,
        province: bodyData.province,
        city: bodyData.city,
        postalCode: bodyData.postalCode,
        address: addressBlocks,
        isDefault: bodyData.isDefault ?? isFirst,
        customer: customer.documentId,
      },
    });

    return {
      success: true,
      data: created,
    };
  },

  async updateMine(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized("ابتدا وارد شوید");
    }

    const customer = await strapi
      .documents("api::customer.customer")
      .findFirst({
        filters: {
          users_permissions_user: {
            id: user.id,
          },
        },
      });

    if (!customer) {
      return ctx.notFound("مشتری پیدا نشد");
    }

    const addressId = ctx.params.id;

    const address = await strapi.documents("api::address.address").findOne({
      documentId: addressId,
      populate: { customer: true },
    });

    if (!address || address.customer?.documentId !== customer.documentId) {
      return ctx.forbidden("دسترسی غیرمجاز");
    }

    const bodyData = ctx.request.body?.data || ctx.request.body || {};

    if (bodyData.isDefault) {
      const existing = await strapi.documents("api::address.address").findMany({
        filters: {
          customer: { documentId: customer.documentId },
          isDefault: true,
        },
      });
      for (const item of existing) {
        if (item.documentId !== addressId) {
          await strapi.documents("api::address.address").update({
            documentId: item.documentId,
            data: { isDefault: false },
          });
        }
      }
    }

    let addressBlocks = bodyData.address;
    if (typeof bodyData.address === "string") {
      addressBlocks = [
        {
          type: "paragraph",
          children: [{ type: "text", text: bodyData.address }],
        },
      ];
    }

    const updated = await strapi.documents("api::address.address").update({
      documentId: addressId,
      data: {
        ...(bodyData.title !== undefined ? { title: bodyData.title } : {}),
        ...(bodyData.receiverName !== undefined ? { receiverName: bodyData.receiverName } : {}),
        ...(bodyData.receiverPhone !== undefined ? { receiverPhone: bodyData.receiverPhone } : {}),
        ...(bodyData.province !== undefined ? { province: bodyData.province } : {}),
        ...(bodyData.city !== undefined ? { city: bodyData.city } : {}),
        ...(bodyData.postalCode !== undefined ? { postalCode: bodyData.postalCode } : {}),
        ...(addressBlocks !== undefined ? { address: addressBlocks } : {}),
        ...(bodyData.isDefault !== undefined ? { isDefault: bodyData.isDefault } : {}),
      },
    });

    return {
      success: true,
      data: updated,
    };
  },

  async deleteMine(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized("ابتدا وارد شوید");
    }

    const customer = await strapi
      .documents("api::customer.customer")
      .findFirst({
        filters: {
          users_permissions_user: {
            id: user.id,
          },
        },
      });

    if (!customer) {
      return ctx.notFound("مشتری پیدا نشد");
    }

    const addressId = ctx.params.id;

    const address = await strapi.documents("api::address.address").findOne({
      documentId: addressId,
      populate: { customer: true, orders: true },
    });

    if (!address || address.customer?.documentId !== customer.documentId) {
      return ctx.forbidden("دسترسی غیرمجاز");
    }

    // Guard: do not hard-delete an address referenced by existing orders
    if (address.orders && address.orders.length > 0) {
      return ctx.badRequest("این آدرس در سفارش‌های قبلی ثبت شده و قابل حذف نیست");
    }

    await strapi.documents("api::address.address").delete({
      documentId: addressId,
    });

    return {
      success: true,
      data: { documentId: addressId },
    };
  },
}));
