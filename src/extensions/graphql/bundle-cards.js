"use strict";

const { computeBundlePricing } = require("../../utils/bundle-price");
const {
  getBundleAvailabilityFromBundle,
} = require("../../utils/bundle-availability");

const BUNDLE_UID = "api::product-bundle.product-bundle";

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

const BUNDLE_POPULATE = {
  items: {
    populate: {
      productVariant: {
        populate: { inventories: true, product: true },
      },
    },
  },
  images: true,
  category: true,
};

function clampLimit(value) {
  const n = Number.isInteger(value) ? value : DEFAULT_LIMIT;

  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, n));
}

// Same expiry-reconciliation precondition getBundleAvailabilityFromBundle
// documents — must run before it reads variant.inventories. Reuses
// api::inventory.inventory#reconcileExpiry unmodified.
async function reconcileBundleExpiry(strapi, bundle) {
  const inventoryService = strapi.service("api::inventory.inventory");

  for (const item of bundle.items || []) {
    if (item.productVariant?.inventories) {
      await inventoryService.reconcileExpiry(item.productVariant.inventories);
    }
  }

  return bundle;
}

function toBundleCard(bundle) {
  const pricing = computeBundlePricing(bundle);
  const availability = getBundleAvailabilityFromBundle(bundle);

  return {
    documentId: bundle.documentId,

    title: bundle.title,

    slug: bundle.slug,

    shortDescription: bundle.shortDescription ?? null,

    images: bundle.images ?? [],

    category: bundle.category
      ? {
          name: bundle.category.name,
          slug: bundle.category.slug,
        }
      : null,

    bundlePrice: pricing.bundlePrice,
    regularComponentTotal: pricing.regularComponentTotal,
    currentComponentTotal: pricing.currentComponentTotal,
    discountAmount: pricing.discountAmount,
    discountPercentage: pricing.discountPercentage,
    incrementalDiscountAmount: pricing.incrementalDiscountAmount,
    incrementalDiscountPercentage: pricing.incrementalDiscountPercentage,
    hasDiscount: pricing.hasDiscount,

    available: availability.available,
    availableQuantity: availability.availableQuantity,

    items: (bundle.items || []).map((item) => ({
      quantity: item.quantity,

      productVariant: item.productVariant
        ? {
            documentId: item.productVariant.documentId,
            sku: item.productVariant.sku ?? null,
            price: item.productVariant.price ?? null,
            discountPrice: item.productVariant.discountPrice ?? null,
            productName: item.productVariant.product?.name ?? null,
          }
        : null,
    })),
  };
}

module.exports = ({ nexus, strapi }) => ({
  types: [
    nexus.objectType({
      name: "BundleCardCategory",

      definition(t) {
        t.nonNull.string("name");
        t.nonNull.string("slug");
      },
    }),

    nexus.objectType({
      name: "BundleComponentVariant",

      definition(t) {
        t.nonNull.id("documentId");
        t.string("sku");
        t.float("price");
        t.float("discountPrice");
        t.string("productName");
      },
    }),

    nexus.objectType({
      name: "BundleItemCard",

      definition(t) {
        t.nonNull.int("quantity");

        t.field("productVariant", {
          type: "BundleComponentVariant",
        });
      },
    }),

    nexus.objectType({
      name: "BundleCard",

      definition(t) {
        t.nonNull.id("documentId");
        t.nonNull.string("title");
        t.nonNull.string("slug");
        t.string("shortDescription");

        t.nonNull.list.nonNull.field("images", {
          type: "UploadFile",
        });

        t.field("category", {
          type: "BundleCardCategory",
        });

        t.nonNull.float("bundlePrice");
        t.nonNull.float("regularComponentTotal");
        t.nonNull.float("currentComponentTotal");
        t.nonNull.float("discountAmount");
        t.nonNull.float("discountPercentage");
        t.nonNull.float("incrementalDiscountAmount");
        t.nonNull.float("incrementalDiscountPercentage");
        t.nonNull.boolean("hasDiscount");

        t.nonNull.boolean("available");
        t.nonNull.int("availableQuantity");

        t.nonNull.list.nonNull.field("items", {
          type: "BundleItemCard",
        });
      },
    }),

    nexus.extendType({
      type: "Query",

      definition(t) {
        t.nonNull.list.nonNull.field("bundleCards", {
          type: "BundleCard",

          args: {
            documentIds: nexus.list(nexus.nonNull(nexus.idArg())),

            limit: nexus.intArg({
              default: DEFAULT_LIMIT,
            }),
          },

          resolve: async (_parent, args) => {
            const limit = clampLimit(args.limit);

            const filters =
              Array.isArray(args.documentIds) && args.documentIds.length > 0
                ? {
                    documentId: { $in: args.documentIds },
                    isActive: true,
                  }
                : { isActive: true };

            const bundles = await strapi.documents(BUNDLE_UID).findMany({
              filters,
              status: "published",
              populate: BUNDLE_POPULATE,
              limit,
            });

            for (const bundle of bundles) {
              // eslint-disable-next-line no-await-in-loop
              await reconcileBundleExpiry(strapi, bundle);
            }

            return bundles.map(toBundleCard);
          },
        });

        t.field("bundleCard", {
          type: "BundleCard",

          args: {
            slug: nexus.nonNull(nexus.stringArg()),
          },

          resolve: async (_parent, args) => {
            const bundle = await strapi.documents(BUNDLE_UID).findFirst({
              filters: { slug: args.slug },
              status: "published",
              populate: BUNDLE_POPULATE,
            });

            if (!bundle) return null;

            await reconcileBundleExpiry(strapi, bundle);

            return toBundleCard(bundle);
          },
        });
      },
    }),
  ],

  resolversConfig: {
    "Query.bundleCards": {
      auth: false,
    },
    "Query.bundleCard": {
      auth: false,
    },
  },
});
