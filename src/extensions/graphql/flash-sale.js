"use strict";

/**
 * Sibling to product-list.js. Finds the current active campaign (reusing
 * utils/campaign.isActive unmodified), fetches its linked products via a
 * direct, status:"published" findMany (avoids relying on relation-
 * population draft/publish defaults), and reuses computeProductPricing/
 * computeProductRating unmodified — same pattern as product-list.js.
 */

const campaignUtil = require("../../utils/campaign");

const {
  computeProductPricing,
  computeProductRating,
} = require("../../utils/product-pricing");

const { getBestSellerDocumentIds } = require("../../utils/best-sellers");

const {
  AVAILABILITY_STATUS,
  AVAILABILITY_LABELS,
} = require("../../utils/inventory");

const FALLBACK_AVAILABILITY = {
  status: AVAILABILITY_STATUS.OUT_OF_STOCK,
  label: AVAILABILITY_LABELS[AVAILABILITY_STATUS.OUT_OF_STOCK],
  availableQuantity: 0,
};

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

function clampLimit(value) {
  const n = Number.isInteger(value) ? value : DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, n));
}

module.exports = ({ nexus, strapi }) => ({
  types: [
    nexus.objectType({
      name: "FlashSaleResult",
      definition(t) {
        t.string("campaignEndsAt");
        t.string("title");
        t.nonNull.list.nonNull.field("items", {
          type: "ProductCard",
        });
      },
    }),

    nexus.extendType({
      type: "Query",
      definition(t) {
        t.nonNull.field("flashSaleProducts", {
          type: "FlashSaleResult",

          args: {
            limit: nexus.intArg({
              default: DEFAULT_LIMIT,
            }),
          },

          resolve: async (_parent, args) => {
            const limit = clampLimit(args.limit);

            const campaigns = await strapi
              .documents("api::campaign.campaign")
              .findMany({
                filters: {
                  active: {
                    $eq: true,
                  },
                },
                status: "published",
                populate: {
                  products: true,
                },
              });

            const active = campaigns
              .filter((c) => campaignUtil.isActive(c))
              .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];

            if (!active || !active.products?.length) {
              return {
                campaignEndsAt: null,
                title: null,
                items: [],
              };
            }

            const productIds = active.products.map((p) => p.documentId);

            const products = await strapi
              .documents("api::product.product")
              .findMany({
                filters: {
                  documentId: {
                    $in: productIds,
                  },
                },
                status: "published",
                populate: {
                  variants: {
                    populate: {
                      attributes: true,
                    },
                  },
                  brand: true,
                  category: true,
                  images: true,
                  campaigns: true,
                  reviews: {
                    filters: {
                      approved: true,
                    },
                  },
                },
              });

            // Best Seller ranking, computed once for this request (a
            // single SQL query - not one per product, see utils/best-sellers.js).
            const bestSellerIds = await getBestSellerDocumentIds(strapi);

            const items = products.slice(0, limit).map((product) => {
              const pricing = computeProductPricing(product);
              const rating = computeProductRating(product.reviews);

              return {
                documentId: product.documentId,
                name: product.name,
                slug: product.slug,
                images: product.images,

                selectedVariant: pricing.selectedVariant ?? null,

                variants: pricing.variants ?? [],
                startingPrice: pricing.startingPrice ?? null,

                originalPrice: pricing.originalPrice ?? null,
                finalPrice: pricing.finalPrice ?? null,
                hasDiscount: pricing.hasDiscount ?? null,
                discountAmount: pricing.discountAmount ?? null,

                averageRating: rating.averageRating,
                reviewCount: rating.reviewCount,

                isBestSeller: bestSellerIds.has(product.documentId),
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

                availability: product.availability ?? FALLBACK_AVAILABILITY,
              };
            });

            return {
              campaignEndsAt: active.endDate,
              title: active.title,
              items,
            };
          },
        });
      },
    }),
  ],

  resolversConfig: {
    "Query.flashSaleProducts": {
      auth: false,
    },
  },
});
