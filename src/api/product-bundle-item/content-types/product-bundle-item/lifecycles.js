"use strict";

/**
 * Validation rules for a bundle component:
 *  - quantity > 0 (schema enforces min:1; this is defense in depth,
 *    matching api::inventory.inventory/lifecycles.js style)
 *  - the referenced productVariant must exist and be active — an
 *    invalid or inactive variant can never end up inside a bundle
 *  - the same (bundle, productVariant) pair can't appear twice — the
 *    admin should raise the quantity on the existing row instead
 *
 * Self-reference / bundle-inside-bundle is structurally impossible:
 * `productVariant`'s target is fixed to ProductVariant, so a
 * ProductBundleItem can never point at another ProductBundle.
 *
 * Relation references are normalized through utils/relation-input.js.
 * That is the fix for "Undefined attribute level operator id": the admin
 * relation picker sends `{ connect: [{ id: 12, position: {...} }] }`, and
 * the previous implementation passed that raw object straight into
 * `documents().findOne({ documentId: <object> })`.
 */

const {
  resolveRelationDocumentId,
} = require("../../../../utils/relation-input");

const VARIANT_UID = "api::product-variant.product-variant";
const BUNDLE_ITEM_UID = "api::product-bundle-item.product-bundle-item";

async function validate(
  strapi,
  data,
  { currentDocumentId, existingVariantId, existingBundleId } = {},
) {
  if (data.quantity !== undefined && Number(data.quantity) <= 0) {
    throw new Error("Bundle item quantity must be greater than 0");
  }

  const variantId =
    (await resolveRelationDocumentId(strapi, VARIANT_UID, data.productVariant)) ??
    existingVariantId ??
    null;

  const bundleId =
    (await resolveRelationDocumentId(
      strapi,
      "api::product-bundle.product-bundle",
      data.bundle,
    )) ??
    existingBundleId ??
    null;

  if (variantId) {
    const variant = await strapi.documents(VARIANT_UID).findOne({
      documentId: variantId,
    });

    if (!variant) {
      throw new Error("Referenced product variant does not exist");
    }

    if (!variant.isActive) {
      throw new Error("Cannot add an inactive product variant to a bundle");
    }
  }

  if (variantId && bundleId) {
    const siblings = await strapi.documents(BUNDLE_ITEM_UID).findMany({
      filters: {
        bundle: { documentId: bundleId },
        productVariant: { documentId: variantId },
      },
    });

    const hasDuplicate = siblings.some(
      (sibling) => sibling.documentId !== currentDocumentId,
    );

    if (hasDuplicate) {
      throw new Error(
        "This product variant is already a component of this bundle — increase its quantity instead of adding a duplicate row",
      );
    }
  }
}

module.exports = {
  async beforeCreate(event) {
    await validate(strapi, event.params.data);
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;

    const currentRow = await strapi.db.query(BUNDLE_ITEM_UID).findOne({
      where,
      select: ["documentId"],
    });

    let existingVariantId;
    let existingBundleId;

    if (currentRow?.documentId) {
      const populated = await strapi.documents(BUNDLE_ITEM_UID).findOne({
        documentId: currentRow.documentId,
        populate: { bundle: true, productVariant: true },
      });

      existingVariantId = populated?.productVariant?.documentId;
      existingBundleId = populated?.bundle?.documentId;
    }

    await validate(strapi, data, {
      currentDocumentId: currentRow?.documentId,
      existingVariantId,
      existingBundleId,
    });
  },
};
