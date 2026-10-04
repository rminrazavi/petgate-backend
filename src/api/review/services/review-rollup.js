"use strict";

/**
 * Pure rating rollup, kept out of review.js because that file calls
 * `createCoreService` and so cannot be required from a unit test — and this
 * calculation is exactly the part that has to be tested (see
 * tests/api/review-rollup.test.js).
 */

/** Bounds the rollup scan on a product with a very long review history. */
const MAX_ROLLUP_REVIEWS = 5000;

/**
 * @param {Array<{ rating: number }>} reviews APPROVED reviews only
 * @returns {{ averageRating: number, reviewCount: number }}
 */
function computeRollup(reviews = []) {
  const ratings = reviews
    .map((review) => Number(review?.rating))
    .filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5);

  if (ratings.length === 0) {
    return { averageRating: 0, reviewCount: 0 };
  }

  const sum = ratings.reduce((acc, rating) => acc + rating, 0);

  return {
    averageRating: Number((sum / ratings.length).toFixed(1)),
    reviewCount: ratings.length,
  };
}

module.exports = { MAX_ROLLUP_REVIEWS, computeRollup };
