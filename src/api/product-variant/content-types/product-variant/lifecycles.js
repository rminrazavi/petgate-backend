"use strict";

const { getUniqueSku } = require("../../../../utils/sku");
const { getEffectivePrice } = require("../../../../utils/price");

const VARIANT_UID = "api::product-variant.product-variant";

function validatePrice(price, discountPrice) {
  getEffectivePrice({ price, discountPrice });
  if (
    discountPrice !== null &&
    discountPrice !== undefined &&
    Number(discountPrice) > Number(price)
  ) {
    throw new Error("discountPrice cannot be greater than price");
  }
}

/**
 * ProductVariant is the sellable unit, so SKU generation lives here and
 * is fully automatic: an admin never has to type one.
 *
 * - create: a SKU is always assigned. A caller-supplied SKU (admin,
 *   seeders, a data import) is preserved for compatibility, but nothing
 *   can be created *without* one.
 * - update: SKU is immutable once set, so a generated SKU stays stable
 *   for the lifetime of the variant (labels, orders and invoices already
 *   reference it). A row that somehow has no SKU yet gets one here.
 */
module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;

    validatePrice(data.price, data.discountPrice);

    const providedSku =
      typeof data.sku === "string" && data.sku.trim() ? data.sku.trim() : null;

    data.sku = providedSku ?? (await getUniqueSku(strapi, { uid: VARIANT_UID }));
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;

    const current = await strapi.db
      .query(VARIANT_UID)
      .findOne({ where, select: ["sku", "price", "discountPrice"] });

    if (!current) throw new Error("ProductVariant not found");

    validatePrice(
      data.price ?? current.price,
      Object.prototype.hasOwnProperty.call(data, "discountPrice")
        ? data.discountPrice
        : current.discountPrice,
    );

    if ("sku" in data) {
      // Immutable once set: silently drop any attempted change, whatever
      // the payload contains.
      if (current?.sku) {
        delete data.sku;
        return;
      }

      const providedSku =
        typeof data.sku === "string" && data.sku.trim()
          ? data.sku.trim()
          : null;

      data.sku =
        providedSku ?? (await getUniqueSku(strapi, { uid: VARIANT_UID }));

      return;
    }

    // Backfill: a legacy row without a SKU gets one on its next write.
    if (!current?.sku) {
      data.sku = await getUniqueSku(strapi, { uid: VARIANT_UID });
    }
  },
};
