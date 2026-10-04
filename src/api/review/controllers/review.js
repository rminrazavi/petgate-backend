"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

const { blocksToText } = require("../../../utils/blocks");

/** Same public projection as the GraphQL resolver: display name only. */
function buildDisplayName(customer) {
  if (!customer) return "مشتری";

  const name = `${customer.firstName?.trim() ?? ""} ${
    customer.lastName?.trim() ?? ""
  }`.trim();

  return name || "مشتری";
}

module.exports = createCoreController("api::review.review", ({ strapi }) => ({
  async create(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized("ابتدا وارد شوید");
    }

    const { productId, rating, comment, title } = ctx.request.body ?? {};

    if (!productId || !rating) {
      return ctx.badRequest("اطلاعات ناقص است");
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

    const review = await strapi
      .service("api::review.review")
      .createReview(customer.documentId, productId, rating, comment, title);

    return {
      success: true,
      data: review,
    };
  },

  async list(ctx) {
    const { productId } = ctx.params;

    const reviews = await strapi.documents("api::review.review").findMany({
      filters: {
        product: {
          documentId: productId,
        },
        approved: true,
      },
      status: "published",
      fields: ["documentId", "rating", "title", "comment", "createdAt"],

      /* Only the display name is ever needed here. Populating the whole
         customer leaked phone/nationalCode/email through this public route
         (the GraphQL resolver already selects just the two name fields). */
      populate: {
        customer: { fields: ["firstName", "lastName"] },
      },
      sort: { createdAt: "desc" },
    });

    return {
      success: true,
      data: reviews.map((review) => ({
        documentId: review.documentId,
        rating: review.rating,
        title: review.title ?? null,
        comment: blocksToText(review.comment),
        createdAt: review.createdAt,
        author: buildDisplayName(review.customer),
      })),
    };
  },
}));
