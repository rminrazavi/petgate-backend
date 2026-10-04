"use strict";

/**
 * Product reviews for the product detail page.
 *
 * Exports only:
 * - Approved reviews (published + approved = true)
 * - Author display name (no phone/nationalCode/email)
 * - Aggregates: average rating, total count, rating distribution
 *
 * Never exposes:
 * - Unapproved reviews
 * - Customer personal data (phone, nationalCode, email)
 * - Customer full object
 *
 * PHASE 7 ADDITIONS
 * -----------------
 * `page`/`pageSize` and `ratingDistribution` were added because the approved
 * wireframe's review block shows a 5-row distribution bar chart and a
 * "load more" list. Both are computed from REAL approved reviews; there is no
 * placeholder distribution and no fabricated review. The aggregates are
 * always computed over the whole approved set, never over the current page,
 * so page 2 cannot report a different average than page 1.
 */

const { blocksToText } = require("../../utils/blocks");

const REVIEW_UID = "api::review.review";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
/** Aggregates read a ratings-only projection; this bounds that scan. */
const MAX_AGGREGATED_REVIEWS = 5000;

const EMPTY_DISTRIBUTION = [5, 4, 3, 2, 1].map((rating) => ({
  rating,
  count: 0,
  percent: 0,
}));

function clampPageSize(value) {
  const parsed = Number.isInteger(value) ? value : DEFAULT_PAGE_SIZE;

  return Math.min(MAX_PAGE_SIZE, Math.max(1, parsed));
}

function clampPage(value) {
  return Number.isInteger(value) && value > 0 ? value : 1;
}

/**
 * @param {number[]} ratings every approved rating for the product
 * @returns {{ averageRating: number, count: number, ratingDistribution: Array }}
 */
function computeReviewAggregates(ratings = []) {
  const valid = ratings
    .map((rating) => Number(rating))
    .filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5)
    .map((rating) => Math.round(rating));

  if (valid.length === 0) {
    return {
      averageRating: 0,
      count: 0,
      ratingDistribution: EMPTY_DISTRIBUTION.map((bucket) => ({ ...bucket })),
    };
  }

  const buckets = new Map([5, 4, 3, 2, 1].map((rating) => [rating, 0]));

  for (const rating of valid) {
    buckets.set(rating, (buckets.get(rating) ?? 0) + 1);
  }

  const total = valid.length;
  const sum = valid.reduce((acc, rating) => acc + rating, 0);

  return {
    /* One decimal: the UI prints "۴٫۶", and a full float would make the
       aggregateRating in the page's structured data look fabricated. */
    averageRating: Math.round((sum / total) * 10) / 10,
    count: total,
    ratingDistribution: [5, 4, 3, 2, 1].map((rating) => {
      const count = buckets.get(rating) ?? 0;

      return {
        rating,
        count,
        percent: Math.round((count / total) * 100),
      };
    }),
  };
}

function buildDisplayName(customer) {
  if (!customer) return "مشتری";

  const firstName = customer.firstName?.trim() || "";
  const lastName = customer.lastName?.trim() || "";

  if (firstName || lastName) {
    return `${firstName} ${lastName}`.trim();
  }

  return "مشتری";
}

function emptyResult(page, pageSize) {
  return {
    averageRating: 0,
    count: 0,
    page,
    pageSize,
    hasMore: false,
    ratingDistribution: EMPTY_DISTRIBUTION.map((bucket) => ({ ...bucket })),
    reviews: [],
  };
}

module.exports = ({ nexus, strapi }) => ({
  types: [
    nexus.objectType({
      name: "ReviewAuthor",
      definition(t) {
        t.nonNull.string("displayName");
      },
    }),

    nexus.objectType({
      name: "ReviewItem",
      definition(t) {
        t.nonNull.string("documentId");
        t.nonNull.int("rating");
        t.string("title");
        t.string("comment");
        t.nonNull.field("author", { type: "ReviewAuthor" });
        t.nonNull.list.nonNull.field("images", { type: "UploadFile" });
        t.nonNull.string("createdAt");
      },
    }),

    nexus.objectType({
      name: "ReviewRatingBucket",
      definition(t) {
        t.nonNull.int("rating");
        t.nonNull.int("count");
        t.nonNull.int("percent");
      },
    }),

    nexus.objectType({
      name: "ProductReviews",
      definition(t) {
        t.nonNull.float("averageRating");
        t.nonNull.int("count");
        t.nonNull.int("page");
        t.nonNull.int("pageSize");
        t.nonNull.boolean("hasMore");
        t.nonNull.list.nonNull.field("ratingDistribution", {
          type: "ReviewRatingBucket",
        });
        t.nonNull.list.nonNull.field("reviews", { type: "ReviewItem" });
      },
    }),

    nexus.extendType({
      type: "Query",
      definition(t) {
        t.field("productReviews", {
          type: "ProductReviews",
          args: {
            slug: nexus.nonNull(nexus.stringArg()),
            page: nexus.intArg({ default: 1 }),
            pageSize: nexus.intArg({ default: DEFAULT_PAGE_SIZE }),
          },
          resolve: async (_parent, args) => {
            const page = clampPage(args.page);
            const pageSize = clampPageSize(args.pageSize);

            try {
              const product = await strapi
                .documents("api::product.product")
                .findFirst({
                  filters: { slug: { $eq: args.slug } },
                  status: "published",
                  fields: ["documentId"],
                });

              if (!product) return emptyResult(page, pageSize);

              const filters = {
                product: { documentId: { $eq: product.documentId } },
                approved: { $eq: true },
              };

              /* Aggregates first, over a ratings-only projection: average,
                 total and distribution must describe the whole approved set,
                 not the page being rendered. */
              const allRatings = await strapi.documents(REVIEW_UID).findMany({
                filters,
                status: "published",
                fields: ["rating"],
                limit: MAX_AGGREGATED_REVIEWS,
              });

              const aggregates = computeReviewAggregates(
                allRatings.map((review) => review.rating),
              );

              if (aggregates.count === 0) return emptyResult(page, pageSize);

              const start = (page - 1) * pageSize;

              const reviews = await strapi.documents(REVIEW_UID).findMany({
                filters,
                status: "published",
                fields: [
                  "documentId",
                  "rating",
                  "title",
                  "comment",
                  "createdAt",
                ],
                populate: {
                  customer: { fields: ["firstName", "lastName"] },
                  images: true,
                },
                sort: { createdAt: "desc" },
                start,
                limit: pageSize,
              });

              return {
                averageRating: aggregates.averageRating,
                count: aggregates.count,
                page,
                pageSize,
                hasMore: start + reviews.length < aggregates.count,
                ratingDistribution: aggregates.ratingDistribution,
                reviews: reviews.map((review) => ({
                  documentId: review.documentId,
                  rating: review.rating,
                  title: review.title ?? null,
                  /* `comment` is a blocks field, and this API exposes it as
                     a String. Serialising it here (instead of letting nexus
                     coerce an array) is why comments now actually reach the
                     storefront — see src/utils/blocks.js. */
                  comment: blocksToText(review.comment),
                  author: {
                    displayName: buildDisplayName(review.customer),
                  },
                  images: review.images ?? [],
                  createdAt: review.createdAt,
                })),
              };
            } catch (error) {
              strapi.log.error(
                `[MOPET productReviews] failed ${JSON.stringify({
                  slug: args.slug,
                  page,
                  pageSize,
                  message: error.message,
                })}`,
              );

              /* Rethrown, not hidden: the product page needs a real error
                 state for its review block rather than a silent "0 reviews"
                 that would look like a product nobody has bought. */
              throw error;
            }
          },
        });
      },
    }),
  ],

  resolversConfig: {
    "Query.productReviews": { auth: false },
  },
});

module.exports.DEFAULT_PAGE_SIZE = DEFAULT_PAGE_SIZE;
module.exports.MAX_PAGE_SIZE = MAX_PAGE_SIZE;
module.exports.buildDisplayName = buildDisplayName;
module.exports.clampPage = clampPage;
module.exports.clampPageSize = clampPageSize;
module.exports.computeReviewAggregates = computeReviewAggregates;
