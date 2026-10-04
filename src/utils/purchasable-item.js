"use strict";

/**
 * Shared "exactly one of product_variant / product_bundle" rule for
 * CartItem and OrderItem, plus itemType derivation.
 *
 * Both content-types express the same idea (a line item is EITHER a
 * single variant OR a bundle), so the rule lives here once instead of
 * being duplicated in two lifecycle files.
 *
 * Relation presence is detected through utils/relation-input.js, so the
 * admin panel's `{ connect: [{ id }] }` payload is understood exactly
 * like the Document Service's plain documentId string.
 */

const { hasRelation } = require("./relation-input");

/**
 * @param {object} data      lifecycle payload (mutated: itemType filled in)
 * @param {object} existing  { hasVariant, hasBundle } for updates
 */
function validateExactlyOnePurchasable(data, existing) {
  const dataHasVariant =
    "product_variant" in data
      ? hasRelation(data.product_variant)
      : existing.hasVariant;

  const dataHasBundle =
    "product_bundle" in data
      ? hasRelation(data.product_bundle)
      : existing.hasBundle;

  if (dataHasVariant === dataHasBundle) {
    throw new Error(
      "Exactly one of product_variant or product_bundle must be set",
    );
  }

  const expected = dataHasBundle ? "bundle" : "variant";

  if (data.itemType && data.itemType !== expected) {
    throw new Error(`itemType must be "${expected}" for this item`);
  }

  if (!("itemType" in data)) {
    data.itemType = expected;
  }
}

/** Reads the currently-persisted relation flags for an update. */
async function resolveExistingPurchasableFlags(strapi, uid, where) {
  const current = await strapi.db
    .query(uid)
    .findOne({ where, select: ["documentId"] });

  if (!current?.documentId) {
    return { hasVariant: false, hasBundle: false };
  }

  const populated = await strapi.documents(uid).findOne({
    documentId: current.documentId,
    populate: { product_variant: true, product_bundle: true },
  });

  return {
    hasVariant: !!populated?.product_variant,
    hasBundle: !!populated?.product_bundle,
  };
}

module.exports = {
  validateExactlyOnePurchasable,
  resolveExistingPurchasableFlags,
};
