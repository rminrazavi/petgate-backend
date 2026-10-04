"use strict";

const REVIEW_UID = "api::review.review";

/**
 * Keeps Product.averageRating / Product.reviewCount in sync with the
 * approved reviews.
 *
 * A lifecycle rather than controller code on purpose: the field that moves
 * the aggregate is `approved`, and that is toggled in the ADMIN PANEL, which
 * never goes through the API controller. Putting the rollup here is the only
 * way an approval, an edit, an un-approval or a delete all update the
 * product. Without it, `approved` had no effect on anything a customer sees.
 */

async function resolveProductId(event, resultProduct) {
  if (resultProduct?.documentId) return resultProduct.documentId;

  const relation = event.params?.data?.product;

  if (typeof relation === "string") return relation;
  if (relation?.documentId) return relation.documentId;
  if (Array.isArray(relation?.connect) && relation.connect[0]) {
    const first = relation.connect[0];

    return typeof first === "string" ? first : (first.documentId ?? null);
  }

  const documentId = event.result?.documentId ?? event.params?.where?.documentId;

  if (!documentId) return null;

  const review = await strapi.documents(REVIEW_UID).findOne({
    documentId,
    populate: { product: { fields: ["slug"] } },
  });

  return review?.product?.documentId ?? null;
}

async function sync(event) {
  try {
    const productId = await resolveProductId(event, event.result?.product);

    if (!productId) return;

    await strapi.service(REVIEW_UID).syncProductRating(productId);
  } catch (error) {
    // A failed rollup must never fail the write that triggered it.
    strapi.log.error(`[review] Rating rollup failed: ${error.message}`);
  }
}

module.exports = {
  async afterCreate(event) {
    await sync(event);
  },

  async beforeUpdate(event) {
    // Capture the product BEFORE the write, so moving a review between
    // products (admin panel) refreshes the product it left as well.
    const documentId = event.params?.where?.documentId ?? event.params?.documentId;

    if (!documentId) return;

    try {
      const existing = await strapi.documents(REVIEW_UID).findOne({
        documentId,
        populate: { product: { fields: ["slug"] } },
      });

      event.state = {
        ...(event.state ?? {}),
        previousProductId: existing?.product?.documentId ?? null,
      };
    } catch {
      // Best effort only.
    }
  },

  async afterUpdate(event) {
    const previousProductId = event.state?.previousProductId ?? null;

    await sync(event);

    const currentProductId = await resolveProductId(event, event.result?.product);

    if (previousProductId && previousProductId !== currentProductId) {
      try {
        await strapi.service(REVIEW_UID).syncProductRating(previousProductId);
      } catch (error) {
        strapi.log.error(`[review] Rating rollup failed: ${error.message}`);
      }
    }
  },

  async beforeDelete(event) {
    const documentId = event.params?.where?.documentId ?? event.params?.documentId;

    if (!documentId) return;

    try {
      const existing = await strapi.documents(REVIEW_UID).findOne({
        documentId,
        populate: { product: { fields: ["slug"] } },
      });

      event.state = {
        ...(event.state ?? {}),
        previousProductId: existing?.product?.documentId ?? null,
      };
    } catch {
      // Best effort only.
    }
  },

  async afterDelete(event) {
    const productId = event.state?.previousProductId ?? null;

    if (!productId) return;

    try {
      await strapi.service(REVIEW_UID).syncProductRating(productId);
    } catch (error) {
      strapi.log.error(`[review] Rating rollup failed: ${error.message}`);
    }
  },
};
