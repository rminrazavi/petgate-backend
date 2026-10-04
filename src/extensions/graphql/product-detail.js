"use strict";

const {
  AVAILABILITY_STATUS,
  AVAILABILITY_LABELS,
} = require("../../utils/inventory");
const { getBestSellerDocumentIds } = require("../../utils/best-sellers");
const { persianSlugify } = require("../../utils/slug");

const PRODUCT_UID = "api::product.product";

const FALLBACK_AVAILABILITY = {
  status: AVAILABILITY_STATUS.OUT_OF_STOCK,
  label: AVAILABILITY_LABELS[AVAILABILITY_STATUS.OUT_OF_STOCK],
  availableQuantity: 0,
};

/**
 * Single-product read for the product detail page (/products/[slug]).
 *
 * Same contract as the other product surfaces in this folder: the pricing,
 * availability, expiry-guarantee and rating computations are NOT repeated
 * here — the canonical api::product.product service
 * (getProductWithPrice) produces them, exactly as it already does for the
 * REST /products/slug/:slug endpoint. This resolver only reshapes that
 * result into the GraphQL contract the storefront consumes.
 *
 * ProductDetail deliberately reuses ProductCard's sub-types
 * (ProductCardCategory / ProductCardBrand / ProductCardVariant /
 * ProductAvailability / ProductCardSelectedVariant, declared in
 * product-cards.js) so there is one product domain model on the frontend,
 * extended with the detail-only fields rather than duplicated.
 *
 * Deliberately NOT exposed:
 *   - individual reviews: Review.customer is personal data and the schema
 *     has no public display-name field, so only the aggregate
 *     averageRating/reviewCount are published.
 *   - Inventory rows / stock numbers: availability is the public contract.
 */
module.exports = ({ nexus, strapi }) => ({
  types: [
    nexus.objectType({
      name: "ProductSpecification",
      definition(t) {
        t.nonNull.string("title");
        t.nonNull.string("value");
      },
    }),

    nexus.objectType({
      name: "ProductSeo",
      definition(t) {
        t.string("metaTitle");
        t.string("metaDescription");
      },
    }),

    nexus.objectType({
      name: "ProductDetail",
      definition(t) {
        // ---- ProductCard contract ----
        t.nonNull.id("documentId");
        t.nonNull.string("name");
        t.nonNull.string("slug");

        t.nonNull.list.nonNull.field("images", { type: "UploadFile" });

        t.field("category", { type: "ProductCardCategory" });

        // First-level parents of the product's category, for breadcrumbs
        // (Category.parents is the animal/taxonomy source of truth).
        t.nonNull.list.nonNull.field("categoryParents", {
          type: "ProductCardCategory",
        });

        t.field("brand", { type: "ProductCardBrand" });
        t.field("selectedVariant", { type: "ProductCardSelectedVariant" });

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

        t.nonNull.field("availability", { type: "ProductAvailability" });

        // ---- Detail-only fields ----
        t.string("shortDescription");
        t.string("description");
        t.string("ingredients");
        t.string("usageGuide");
        t.string("countryOfOrigin");
        t.string("ageGroup");
        t.string("healthCondition");

        t.nonNull.list.nonNull.field("specifications", {
          type: "ProductSpecification",
        });

        t.field("seo", { type: "ProductSeo" });
      },
    }),

    nexus.extendType({
      type: "Query",
      definition(t) {
        t.field("productDetail", {
          type: "ProductDetail",
          args: { slug: nexus.nonNull(nexus.stringArg()) },
          resolve: async (_parent, args) => {
            // Legacy URLs may use Arabic Yeh/Kaf while persisted slugs use
            // Persian forms. Match both the raw and canonical route keys.
            const normalizedSlug = persianSlugify(args.slug);
            const candidates = [...new Set([args.slug, normalizedSlug].filter(Boolean))];
            const match = await strapi.documents(PRODUCT_UID).findFirst({
              filters: { slug: { $in: candidates } },
              status: "published",
              fields: ["slug"],
            });

            if (!match) return null;

            const product = await strapi
              .service(PRODUCT_UID)
              .getProductWithPrice(match.documentId);

            if (!product) return null;

            const [bestSellerIds, categoryParents] = await Promise.all([
              getBestSellerDocumentIds(strapi, {
                productDocumentIds: [product.documentId],
              }),
              resolveCategoryParents(strapi, product.category?.documentId),
            ]);

            return {
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

              categoryParents,

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

              shortDescription: product.shortDescription ?? null,
              description: product.description ?? null,
              ingredients: product.ingredients ?? null,
              usageGuide: product.usageGuide ?? null,
              countryOfOrigin: product.countryOfOrigin ?? null,
              ageGroup: product.ageGroup ?? null,
              healthCondition: product.healthCondition ?? null,

              specifications: (product.specifications ?? [])
                .filter((item) => item?.title && item?.value)
                .map((item) => ({ title: item.title, value: item.value })),

              seo: product.seo
                ? {
                    metaTitle: product.seo.metaTitle ?? null,
                    metaDescription: product.seo.metaDescription ?? null,
                  }
                : null,
            };
          },
        });
      },
    }),
  ],

  resolversConfig: {
    "Query.productDetail": { auth: false },
  },
});

/**
 * `getProductWithPrice` populates `category` one level deep, which is all
 * the card contract needs. Breadcrumbs need the level above it, so the
 * parents are fetched here rather than by widening the shared populate for
 * every product surface.
 */
async function resolveCategoryParents(strapi, categoryDocumentId) {
  if (!categoryDocumentId) return [];

  const category = await strapi.documents("api::category.category").findOne({
    documentId: categoryDocumentId,
    fields: ["name", "slug"],
    populate: { parents: { fields: ["name", "slug"] } },
  });

  return (category?.parents ?? [])
    .filter((parent) => parent?.slug)
    .map((parent) => ({
      documentId: parent.documentId,
      name: parent.name,
      slug: parent.slug,
    }));
}
