"use strict";

/**
 * Document Service middleware: enforces bundle-level business rules
 * only at `publish` time. Same architecture as
 * product-publish-validation.js and for the same reason — the admin
 * panel's Content Manager (including bulk-publish) calls the Document
 * Service directly and never goes through a content-api controller,
 * so `strapi.documents.use(...)` is the only enforcement point that
 * reliably catches every publish path (REST, GraphQL, admin panel, or
 * a programmatic `strapi.documents(...).publish(...)` call).
 *
 * Intentionally does NOT hook create/update — a bundle being actively
 * assembled by an admin (zero items, price not finalized yet) must
 * keep saving as a draft normally. Only `publish` is validated.
 *
 * Rules enforced on publish:
 *   - at least one component
 *   - every component references an existing, active ProductVariant
 *     (a component with a deleted/inactive variant blocks publish
 *     rather than silently becoming unpurchasable)
 *   - bundlePrice >= 0 is already enforced by the schema (`min: 0`) —
 *     not re-checked here
 *   - bundlePrice must be less than the live regularComponentTotal, so
 *     a published bundle is always an actual discount, never a bundle
 *     that costs the same or more than buying the parts separately at
 *     list price
 *
 * Duplicate-component and quantity>=1 rules are already enforced at
 * write time by api::product-bundle-item.product-bundle-item's own
 * lifecycle (see content-types/product-bundle-item/lifecycles.js) —
 * not repeated here, since a bundle can't reach publish with an
 * invalid item in the first place.
 */

const { errors } = require("@strapi/utils");
const { computeBundlePricing } = require("../utils/bundle-price");

const BUNDLE_UID = "api::product-bundle.product-bundle";

function registerBundlePublishValidation(strapi) {
  strapi.documents.use(async (context, next) => {
    if (context.uid !== BUNDLE_UID || context.action !== "publish") {
      return next();
    }

    // documentId is expected on every single-document publish call
    // (REST, admin panel, and each iteration of an admin bulk-publish).
    // Fail open rather than blocking an action we don't understand, if
    // it's ever absent for some future Strapi-internal call shape —
    // same stance product-publish-validation.js takes.
    const documentId = context.params?.documentId;

    if (documentId) {
      const bundle = await strapi.documents(BUNDLE_UID).findOne({
        documentId,
        populate: {
          items: {
            populate: { productVariant: true },
          },
        },
      });

      if (bundle) {
        const items = bundle.items || [];

        if (items.length === 0) {
          throw new errors.ValidationError(
            "برای انتشار باندل باید حداقل یک کالای عضو داشته باشد.",
          );
        }

        const hasInvalidComponent = items.some(
          (item) => !item.productVariant || !item.productVariant.isActive,
        );

        if (hasInvalidComponent) {
          throw new errors.ValidationError(
            "همه اجزای باندل باید به یک تنوع محصول فعال و معتبر متصل باشند.",
          );
        }

        const pricing = computeBundlePricing(bundle);

        if (pricing.bundlePrice >= pricing.regularComponentTotal) {
          throw new errors.ValidationError(
            "قیمت باندل باید کمتر از مجموع قیمت اصلی اجزا باشد تا به‌عنوان یک تخفیف واقعی منتشر شود.",
          );
        }
      }
    }

    return next();
  });
}

module.exports = { registerBundlePublishValidation };
