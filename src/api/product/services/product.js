"use strict";

const { createCoreService } = require("@strapi/strapi").factories;

const {
  computeProductPricing,
  computeProductRating,
} = require("../../../utils/product-pricing");
const {
  rankProductIdsByPrice,
  resolveProductSort,
} = require("../../../utils/product-sort");

// Any newly-expired batch must be transitioned (stock -> stockExpired)
// before computeProductPricing() reads `variant.inventories` — otherwise
// the pricing/expiry-badge computation would work off stale, already
// out-of-date stock numbers for this one request. Mutates the populated
// inventories in place (see api::inventory.inventory#reconcileExpiry).
async function reconcileProductsExpiry(strapi, products) {
  const inventoryService = strapi.service("api::inventory.inventory");

  for (const product of products) {
    for (const variant of product.variants || []) {
      if (variant.inventories) {
        await inventoryService.reconcileExpiry(variant.inventories);
      }
    }
  }
}

/** Ranked (price/discount) ordering needs the full match set before paging. */
const RANKED_CANDIDATE_LIMIT = 2000;

/**
 * The price window is a VARIANT concern too: a product qualifies when the
 * variant the card advertises falls inside the window. Kept identical to the
 * previous behaviour so the fix changes ordering only, never membership.
 */
function applyPriceWindow(products, minPrice, maxPrice) {
  const min = minPrice == null || minPrice === "" ? null : Number(minPrice);
  const max = maxPrice == null || maxPrice === "" ? null : Number(maxPrice);

  return products.filter((product) => {
    const variant =
      product.variants?.find((item) => item.isDefault) || product.variants?.[0];

    if (!variant) return false;

    if (min != null && Number.isFinite(min) && variant.price < min) return false;
    if (max != null && Number.isFinite(max) && variant.price > max) return false;

    return true;
  });
}

module.exports = createCoreService("api::product.product", ({ strapi }) => ({
  async getProductWithPrice(documentId) {
    const product = await strapi.documents("api::product.product").findOne({
      documentId,

      // Public pricing must never resolve the draft version of a
      // product. The raw Document Service API defaults to draft when no
      // status is passed — this was a pre-existing gap, fixed here as
      // an intentional, explicitly-approved change.
      status: "published",

      populate: {
        variants: {
          populate: {
            attributes: true,

            // Needed for computeProductPricing() to derive each
            // variant's card-facing expiry guarantee from Inventory
            // (the source of truth) instead of the deprecated
            // Product.expiryDate. Not previously populated here.
            inventories: true,
          },
        },
        brand: true,
        category: true,
        images: true,
        seo: true,
        specifications: true,
        campaigns: true,
        reviews: {
          filters: {
            approved: true,
          },
          populate: {
            customer: true,
          },
        },
      },
    });

    if (!product) return null;

    await reconcileProductsExpiry(strapi, [product]);

    const pricing = computeProductPricing(product);

    // Preserves the original behavior exactly: product.price and
    // product.selectedVariant are only set when a variant was found.
    if (pricing.selectedVariant) {
      product.price = {
        originalPrice: pricing.originalPrice,
        finalPrice: pricing.finalPrice,
        hasDiscount: pricing.hasDiscount,
        discountAmount: pricing.discountAmount,
      };

      product.selectedVariant = pricing.selectedVariant;
    }

    const rating = computeProductRating(product.reviews);

    product.averageRating = rating.averageRating;

    // Not present in the original method's output. Added for
    // consistency with getProductsWithPrice(), and because it does not
    // remove or change any existing field.
    product.reviewCount = rating.reviewCount;

    // ProductCard availability contract — computed, never Inventory/stock
    // exposed directly. Always present (even with zero variants).
    product.availability = pricing.availability;

    return product;
  },

  /**
   * @param {object} filters   Document Service filters
   * @param {object} [pagination]  { page, pageSize } — explicit so callers
   *   never fetch a default page of 25 just to slice it down to a handful
   *   (see extensions/graphql/product-cards.js).
   */
  async getProductsWithPrice(filters = {}, pagination = {}) {
    const products = await strapi.documents("api::product.product").findMany({
      filters,

      // Same published-only fix as getProductWithPrice().
      status: "published",

      populate: {
        variants: {
          populate: {
            attributes: true,

            // Needed for computeProductPricing() to derive each
            // variant's card-facing expiry guarantee from Inventory
            // (the source of truth) instead of the deprecated
            // Product.expiryDate. Not previously populated here.
            inventories: true,
          },
        },
        brand: true,
        category: true,
        images: true,

        // Added so campaign discounts and rating can be computed at
        // list level, in this same single findMany — no per-product
        // follow-up query.
        campaigns: true,

        reviews: {
          filters: {
            approved: true,
          },
        },
      },

      start:
        ((pagination.page ?? filters.page ?? 1) - 1) *
        (pagination.pageSize ?? filters.pageSize ?? 25),
      limit: pagination.pageSize ?? filters.pageSize ?? 25,
    });

    await reconcileProductsExpiry(strapi, products);

    return products.map((product) => {
      const pricing = computeProductPricing(product);
      const rating = computeProductRating(product.reviews);

      return {
        ...product,

        // Preserves the original shape (price: ... : null), now
        // correctly including the campaign discount.
        price: pricing.selectedVariant
          ? {
              originalPrice: pricing.originalPrice,
              finalPrice: pricing.finalPrice,
              hasDiscount: pricing.hasDiscount,
              discountAmount: pricing.discountAmount,
            }
          : null,

        // Not present in the original method's output.
        selectedVariant: pricing.selectedVariant || null,

        // New ProductCard data.
        variants: pricing.variants,
        startingPrice: pricing.startingPrice,

        // ProductCard availability contract — computed, never
        // Inventory/stock exposed directly.
        availability: pricing.availability,

        averageRating: rating.averageRating,
        reviewCount: rating.reviewCount,
      };
    });
  },

  /**
   * `GET /api/products/search`.
   *
   * `options.sort` used to be ignored entirely, so "cheapest first" silently
   * did nothing on the search route. It now goes through the same authority
   * as every other listing: Product-level keys are ordered by the database,
   * and a price/discount intent is ranked from ProductVariant.price. A raw
   * `price` key can therefore never reach this Product query either.
   */
  async searchProducts(query, page = 1, pageSize = 25, options = {}) {
    const where = {
      name: {
        $containsi: query,
      },
    };

    const populate = {
      images: true,
      brand: true,
      category: true,
      variants: true,
    };

    const resolved = resolveProductSort(options.sort);

    if (resolved.rejected.length > 0) {
      strapi.log.warn(
        `[MOPET searchProducts] ignored unsortable key(s) ${resolved.rejected.join(
          ", ",
        )}; ordered by ${JSON.stringify(resolved.sort)} instead.`,
      );
    }

    const start = (Number(page) - 1) * Number(pageSize);

    if (resolved.rank) {
      return await this.findRankedPage({
        where,
        populate,
        sort: resolved.sort,
        rank: resolved.rank,
        start,
        pageSize: Number(pageSize),
      });
    }

    return await strapi.documents("api::product.product").findMany({
      filters: where,
      sort: resolved.sort,
      populate,

      start,
      limit: Number(pageSize),
    });
  },

  /**
   * Ranked (variant-price / discount) pagination, shared by every listing in
   * this service so there is exactly one implementation of "order the whole
   * match set in the domain layer, then cut the page".
   *
   * The only DB-level price sort happens inside `rankProductIdsByPrice`, on
   * ProductVariant, where the `price` column actually exists.
   */
  async findRankedPage({ where, populate, sort, rank, start, pageSize }) {
    const candidates = await strapi.documents("api::product.product").findMany({
      filters: where,
      fields: ["documentId"],
      sort,
      limit: RANKED_CANDIDATE_LIMIT,
    });

    if (candidates.length === RANKED_CANDIDATE_LIMIT) {
      strapi.log.warn(
        `[MOPET findRankedPage] candidate cap reached (${RANKED_CANDIDATE_LIMIT}); ranking is limited to those candidates.`,
      );
    }

    const ordered = await rankProductIdsByPrice(
      strapi,
      candidates.map((item) => item.documentId),
      { rank },
    );

    const pageIds = ordered.slice(start, start + pageSize);

    if (pageIds.length === 0) return [];

    const products = await strapi.documents("api::product.product").findMany({
      filters: { documentId: { $in: pageIds } },
      populate,
      limit: pageIds.length,
    });

    const position = new Map(pageIds.map((id, index) => [id, index]));

    products.sort(
      (a, b) => position.get(a.documentId) - position.get(b.documentId),
    );

    return products;
  },

  /**
   * ROOT CAUSE OF `ValidationError: Invalid key price`.
   *
   * `GET /api/products/filter` (routes/custom-product.js) handed `ctx.query`
   * straight to this method, and `sort` went straight into a Product
   * `findMany`. `?sort=price:asc` therefore reached Strapi 5's `validateSort`
   * against a schema that has no `price` attribute, because MOPET price lives
   * on ProductVariant. Every request carrying a price sort died with
   * `Invalid key price`.
   *
   * Now the sort is resolved through utils/product-sort.js: Product-level keys
   * are sorted in the database, price/discount intent is answered by the
   * variant layer, and a meaningless key is logged instead of crashing the
   * request. Price ordering still works — it is just computed where price
   * actually lives.
   */
  async filterProducts(filters = {}) {
    const {
      category,
      brand,
      minPrice,
      maxPrice,
      sort,
      page = 1,
      pageSize = 25,
    } = filters;

    const where = {};

    if (category) {
      where.category = {
        documentId: category,
      };
    }

    if (brand) {
      where.brand = {
        documentId: brand,
      };
    }

    const resolved = resolveProductSort(sort);

    if (resolved.rejected.length > 0) {
      strapi.log.warn(
        `[MOPET filterProducts] ignored unsortable key(s) ${resolved.rejected.join(
          ", ",
        )}; ordered by ${JSON.stringify(resolved.sort)} instead.`,
      );
    }

    const start = (Number(page) - 1) * Number(pageSize);

    /*
     * A price/discount ranking has to be applied to the whole matching set
     * BEFORE the page is cut, otherwise page 2 of "cheapest first" would be
     * the second page of a date-ordered list re-sorted in isolation. So the
     * ranked path fetches ids first, orders them in the domain layer, then
     * hydrates only the ids on the current page.
     */
    if (resolved.rank) {
      /* One ranked-pagination implementation, shared with searchProducts. */
      const products = await this.findRankedPage({
        where,
        populate: {
          images: true,
          brand: true,
          category: true,
          variants: true,
        },
        sort: resolved.sort,
        rank: resolved.rank,
        start,
        pageSize: Number(pageSize),
      });

      return applyPriceWindow(products, minPrice, maxPrice);
    }

    const result = await strapi.documents("api::product.product").findMany({
      filters: where,
      sort: resolved.sort,

      populate: {
        images: true,
        brand: true,
        category: true,
        variants: true,
      },

      start,
      limit: Number(pageSize),
    });

    return applyPriceWindow(result, minPrice, maxPrice);
  },
}));
