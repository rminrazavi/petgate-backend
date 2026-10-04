"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

const {
  DEFAULT_PAGE_SIZE,
  PRODUCT_UID,
  findProducts,
} = require("./product-find");

module.exports = createCoreController(PRODUCT_UID, ({ strapi }) => ({
  /**
   * CORE ROUTE OVERRIDE — the runtime path that threw
   * `ValidationError: Invalid key price`.
   *
   * `GET /api/products?sort=price:asc` is PUBLIC (createCoreRouter plus the
   * `api::product.product.find` grant in src/bootstrap/permissions.js). The
   * core controller passes the caller's `sort` through `sanitizeQuery` into
   * the Document Service, where Strapi 5 validates it against
   * product/schema.json — which has no `price` attribute, because MOPET
   * price lives on ProductVariant. So every price-sorted catalogue request
   * died before reaching any MOPET code.
   *
   * Adding a `price` column to Product, or catching the error, would both be
   * wrong. The sort is resolved through the one sorting authority
   * (utils/product-sort.js) instead:
   *
   *   - Product-level keys      -> ordered by the database, as before.
   *   - price/discount intent   -> ranked by ProductVariant.price (a real
   *                                column on THAT table, so it is still a
   *                                DB-level price sort), then paged.
   *
   * The logic lives in ./product-find.js so it is unit-testable without a
   * booted Strapi; src/document-middlewares/product-sort-guard.js enforces
   * the same invariant for callers this controller cannot see.
   */
  async find(ctx) {
    return findProducts({
      strapi,
      ctx,
      coreFind: () => super.find(ctx),
      sanitizeQuery: () => this.sanitizeQuery(ctx),
    });
  },

  async findBySlug(ctx) {
    const { slug } = ctx.params;

    const product = await strapi.documents(PRODUCT_UID).findFirst({
      filters: {
        slug,
      },
    });

    if (!product) {
      return ctx.notFound("محصول پیدا نشد");
    }

    const result = await strapi
      .service("api::product.product")
      .getProductWithPrice(product.documentId);

    return result;
  },

  /**
   * `?sort=` is accepted here too — it used to be dropped silently, which is
   * why "cheapest first" did nothing on the search route — and goes through
   * the same authority, so search can rank by variant price without ever
   * sending `price` into a Product query.
   */
  async search(ctx) {
    const { q, page, pageSize, sort } = ctx.query;

    return await strapi
      .service("api::product.product")
      .searchProducts(q, page || 1, pageSize || DEFAULT_PAGE_SIZE, { sort });
  },

  async filter(ctx) {
    return await strapi
      .service("api::product.product")
      .filterProducts(ctx.query);
  },
}));
