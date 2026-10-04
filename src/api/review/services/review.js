"use strict";

const { createCoreService } = require("@strapi/strapi").factories;

const { textToBlocks } = require("../../../utils/blocks");
const { MAX_ROLLUP_REVIEWS, computeRollup } = require("./review-rollup");

const REVIEW_UID = "api::review.review";
const PRODUCT_UID = "api::product.product";

module.exports = createCoreService(REVIEW_UID, ({ strapi }) => ({
  async createReview(customerId, productId, rating, comment, title = null) {
    if (rating < 1 || rating > 5) {
      throw new Error("امتیاز باید بین ۱ تا ۵ باشد");
    }

    const review = await strapi.documents(REVIEW_UID).create({
      data: {
        customer: customerId,
        product: productId,
        rating,

        /* `comment` is a blocks field. The controller receives plain text
           from the storefront, so it has to be converted here — writing a
           raw string into a blocks attribute produced an invalid document
           (see src/utils/blocks.js). */
        comment: textToBlocks(comment),

        title: title?.trim() || null,

        /* Never auto-approve. An unapproved review is invisible to the
           storefront (productReviews filters on approved = true), which is
           what keeps unmoderated content off the product page. */
        approved: false,
      },
    });

    await this.syncProductRating(productId);

    return review;
  },

  /**
   * Recomputes Product.averageRating and Product.reviewCount from the
   * approved reviews.
   *
   * WHY THIS METHOD EXISTS UNDER THIS NAME
   * -------------------------------------
   * review/content-types/review/lifecycles.js — the only thing that reacts
   * to an admin-panel approval — calls
   * `strapi.service("api::review.review").syncProductRating(...)`, but the
   * service only ever defined `updateProductRating`. Every create, update,
   * approve, un-approve and delete therefore hit the lifecycle's catch block
   * ("Rating rollup failed: ... is not a function") and silently left the
   * product's rating untouched. Approving a review had no visible effect.
   *
   * Two behaviour fixes come with it:
   *  - `reviewCount` is written too; it was never updated before.
   *  - zero approved reviews resets the aggregate to 0 instead of returning
   *    early, so un-approving or deleting the last review no longer leaves a
   *    stale rating on the product forever.
   */
  async syncProductRating(productId) {
    if (!productId) return { averageRating: 0, reviewCount: 0 };

    const reviews = await strapi.documents(REVIEW_UID).findMany({
      filters: {
        product: { documentId: productId },
        approved: true,
      },
      status: "published",
      fields: ["rating"],
      limit: MAX_ROLLUP_REVIEWS,
    });

    const rollup = computeRollup(reviews);

    await strapi.documents(PRODUCT_UID).update({
      documentId: productId,
      data: rollup,
    });

    return rollup;
  },

  /** @deprecated kept as an alias so no existing caller breaks. */
  async updateProductRating(productId) {
    return this.syncProductRating(productId);
  },
}));

module.exports.computeRollup = computeRollup;

