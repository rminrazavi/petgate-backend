"use strict";

/**
 * Document Service middleware: enforces that a Product can only be
 * published when it has at least one active, validly-priced
 * ProductVariant.
 *
 * Why a Document Service middleware and not a controller override:
 *
 * In Strapi 5, `publish` can be triggered from more than one call
 * path:
 *   - the content-api REST route
 *     (POST /api/products/:documentId/actions/publish), handled by
 *     the auto-generated `publish` action on api::product.product's
 *     own controller;
 *   - the admin panel's Content Manager, which does NOT go through
 *     that controller at all — it has its own controller
 *     (plugin::content-manager) that calls the Document Service
 *     directly, including for bulk-publish.
 *
 * A controller override on src/api/product/controllers/product.js
 * would only catch the first path and silently miss every publish
 * done from the admin UI, which is where editors actually publish
 * products in practice. `strapi.documents.use(...)` wraps every
 * Document Service call regardless of caller (REST, GraphQL, admin
 * panel, or a programmatic `strapi.documents(...).publish(...)`
 * call), so it's the only enforcement point that's actually
 * reliable here.
 *
 * This intentionally does NOT hook `create`/`update` — draft
 * Products with zero variants must keep saving normally (see the
 * architecture review, section 4). Only the `publish` action is
 * validated.
 */

const { errors } = require("@strapi/utils");

const PRODUCT_UID = "api::product.product";
const VARIANT_UID = "api::product-variant.product-variant";

function hasValidPrice(variant) {
  return (
    variant.price !== null &&
    variant.price !== undefined &&
    Number(variant.price) > 0
  );
}

function registerProductPublishValidation(strapi) {
  strapi.documents.use(async (context, next) => {
    if (context.uid !== PRODUCT_UID || context.action !== "publish") {
      return next();
    }

    // documentId is expected on every single-document publish call
    // (REST, admin panel, and each iteration of an admin bulk-publish).
    // If it's ever absent for some future Strapi-internal call shape,
    // fail open rather than blocking an action we don't understand —
    // this middleware's job is to add a specific business rule, not
    // to second-guess the platform.
    const documentId = context.params?.documentId;

    if (documentId) {
      const activeVariants = await strapi.documents(VARIANT_UID).findMany({
        filters: {
          product: {
            documentId,
          },
          isActive: true,
        },
      });

      const hasPublishableVariant = activeVariants.some(hasValidPrice);

      if (!hasPublishableVariant) {
        throw new errors.ValidationError(
          "برای انتشار محصول باید حداقل یک تنوع (Variant) فعال با قیمت معتبر داشته باشد.",
        );
      }
    }

    return next();
  });
}

module.exports = { registerProductPublishValidation };
