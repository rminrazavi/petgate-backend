"use strict";

const { getBestSellerDocumentIds } = require("../../utils/best-sellers");

const {
  AVAILABILITY_STATUS,
  AVAILABILITY_LABELS,
} = require("../../utils/inventory");

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

const FALLBACK_AVAILABILITY = {
  status: AVAILABILITY_STATUS.OUT_OF_STOCK,
  label: AVAILABILITY_LABELS[AVAILABILITY_STATUS.OUT_OF_STOCK],
  availableQuantity: 0,
};

function clampLimit(value) {
  const n = Number.isInteger(value) ? value : DEFAULT_LIMIT;

  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, n));
}

module.exports = ({ nexus, strapi }) => ({
  types: [
    nexus.objectType({
      name: "ProductCardCategory",

      definition(t) {
        t.nonNull.id("documentId");
        t.nonNull.string("name");
        t.nonNull.string("slug");
      },
    }),

    nexus.objectType({
      name: "ProductCardBrand",

      definition(t) {
        t.nonNull.string("name");
        t.string("slug");
      },
    }),

    nexus.objectType({
      name: "ProductCardSelectedVariant",

      definition(t) {
        t.nonNull.id("documentId");
        t.string("sku");
        t.string("weight");
        t.string("flavor");
      },
    }),

    nexus.objectType({
      name: "ProductExpiryGuarantee",

      definition(t) {
        t.nonNull.string("label");
        t.nonNull.int("months");
      },
    }),

    nexus.enumType({
      name: "ProductAvailabilityStatus",

      members: Object.values(AVAILABILITY_STATUS),
    }),

    nexus.objectType({
      name: "ProductAvailability",

      definition(t) {
        t.nonNull.field("status", {
          type: "ProductAvailabilityStatus",
        });

        t.nonNull.string("label");

        t.int("availableQuantity");
      },
    }),

    nexus.objectType({
      name: "ProductVariantAttribute",

      definition(t) {
        t.nonNull.string("name");
        t.nonNull.string("value");
      },
    }),

    nexus.objectType({
      name: "ProductCardVariant",

      definition(t) {
        t.nonNull.id("documentId");
        t.string("sku");
        t.string("weight");
        t.string("flavor");
        t.nonNull.list.nonNull.field("attributes", { type: "ProductVariantAttribute" });
        t.float("price");
        t.float("discountPrice");
        t.boolean("isActive");

        t.field("expiryGuarantee", {
          type: "ProductExpiryGuarantee",
        });

        t.nonNull.field("availability", {
          type: "ProductAvailability",
        });
      },
    }),

    nexus.objectType({
      name: "ProductCard",

      definition(t) {
        t.nonNull.id("documentId");
        t.nonNull.string("name");
        t.nonNull.string("slug");

        t.nonNull.list.nonNull.field("images", {
          type: "UploadFile",
        });

        t.field("category", {
          type: "ProductCardCategory",
        });

        t.field("brand", {
          type: "ProductCardBrand",
        });

        t.field("selectedVariant", {
          type: "ProductCardSelectedVariant",
        });

        t.nonNull.list.nonNull.field("variants", {
          type: "ProductCardVariant",
        });

        t.float("startingPrice");
        t.float("originalPrice");
        t.float("finalPrice");
        t.boolean("hasDiscount");
        t.float("discountAmount");

        t.nonNull.float("averageRating");
        t.nonNull.int("reviewCount");

        t.nonNull.boolean("isBestSeller");

        t.nonNull.field("availability", {
          type: "ProductAvailability",
        });
      },
    }),

    nexus.extendType({
      type: "Query",

      definition(t) {
        t.nonNull.list.nonNull.field("productCards", {
          type: "ProductCard",

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
                    documentId: {
                      $in: args.documentIds,
                    },
                  }
                : {};

            const products = await strapi
              .service("api::product.product")
              .getProductsWithPrice(filters, { page: 1, pageSize: limit });

            const bestSellerIds = await getBestSellerDocumentIds(strapi);

            return products.map((product) => ({
              documentId: product.documentId,

              name: product.name,

              slug: product.slug,

              images: product.images ?? [],

              category: product.category
                ? {
                    documentId: product.category.documentId,
                    name: product.category.name,
                    slug: product.category.slug,
                  }
                : null,

              brand: product.brand
                ? {
                    name: product.brand.name,
                    slug: product.brand.slug ?? null,
                  }
                : null,

              selectedVariant: product.selectedVariant ?? null,

              variants: (product.variants ?? []).map((variant) => ({
                ...variant,

                attributes: Array.isArray(variant.attributes)
                  ? variant.attributes
                      .filter((a) => a && typeof a.name === "string" && typeof a.value === "string")
                      .map((a) => ({ name: a.name.trim(), value: a.value.trim() }))
                  : [],

                availability: variant.availability ?? FALLBACK_AVAILABILITY,
              })),

              startingPrice: product.startingPrice ?? null,

              originalPrice: product.price?.originalPrice ?? null,

              finalPrice: product.price?.finalPrice ?? null,

              hasDiscount: product.price?.hasDiscount ?? null,

              discountAmount: product.price?.discountAmount ?? null,

              averageRating: product.averageRating ?? 0,

              reviewCount: product.reviewCount ?? 0,

              isBestSeller: bestSellerIds.has(product.documentId),

              availability: product.availability ?? FALLBACK_AVAILABILITY,
            }));
          },
        });
      },
    }),
  ],

  resolversConfig: {
    "Query.productCards": {
      auth: false,
    },
  },
});
