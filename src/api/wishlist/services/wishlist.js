"use strict";

const { createCoreService } = require("@strapi/strapi").factories;

const WISHLIST_UID = "api::wishlist.wishlist";
const PRODUCT_UID = "api::product.product";

/**
 * Wishlist service.
 *
 * Schema reality (unchanged): Customer 1—1 Wishlist, Wishlist n—n
 * Product. The wishlist is a *product* collection, not a variant one, so
 * a customer favourites "this product", not "this 2kg bag" — matching
 * the existing relation and the ProductCard heart button.
 *
 * Writes use relational `connect`/`disconnect` rather than replacing the
 * whole `products` array. That is what makes concurrent adds safe (two
 * tabs adding different products can no longer clobber each other) and
 * what makes duplicate prevention free — connecting an already-connected
 * product is a no-op at the database level.
 */
module.exports = createCoreService(WISHLIST_UID, ({ strapi }) => ({
  async getOrCreate(customerId) {
    const existing = await strapi.documents(WISHLIST_UID).findFirst({
      filters: { customer: { documentId: customerId } },
      populate: { products: { fields: ["name", "slug"] } },
    });

    if (existing) return existing;

    return strapi.documents(WISHLIST_UID).create({
      data: { customer: customerId },
      populate: { products: { fields: ["name", "slug"] } },
    });
  },

  /** documentIds only — what the storefront needs to render heart state. */
  async listProductIds(customerId) {
    const wishlist = await this.getOrCreate(customerId);

    return (wishlist.products ?? [])
      .map((product) => product?.documentId)
      .filter(Boolean);
  },

  /**
   * Full wishlist payload: ids plus ProductCard-shaped products, built
   * through the canonical product service so pricing/availability match
   * every other product surface exactly.
   */
  async get(customerId) {
    const wishlist = await this.getOrCreate(customerId);

    const productIds = (wishlist.products ?? [])
      .map((product) => product?.documentId)
      .filter(Boolean);

    const products = productIds.length
      ? await strapi
          .service(PRODUCT_UID)
          .getProductsWithPrice(
            { documentId: { $in: productIds } },
            { page: 1, pageSize: productIds.length },
          )
      : [];

    return {
      documentId: wishlist.documentId,
      productIds,
      products,
    };
  },

  async add(customerId, productId) {
    const product = await strapi.documents(PRODUCT_UID).findOne({
      documentId: productId,
      status: "published",
      fields: ["name"],
    });

    if (!product) throw new Error("محصول پیدا نشد");

    const wishlist = await this.getOrCreate(customerId);

    await strapi.documents(WISHLIST_UID).update({
      documentId: wishlist.documentId,
      data: { products: { connect: [productId] } },
    });

    return this.get(customerId);
  },

  async remove(customerId, productId) {
    const wishlist = await this.getOrCreate(customerId);

    await strapi.documents(WISHLIST_UID).update({
      documentId: wishlist.documentId,
      data: { products: { disconnect: [productId] } },
    });

    return this.get(customerId);
  },

  /** @returns {Promise<{wishlisted: boolean, wishlist: object}>} */
  async toggle(customerId, productId) {
    const currentIds = await this.listProductIds(customerId);

    const isWishlisted = currentIds.includes(productId);

    const wishlist = isWishlisted
      ? await this.remove(customerId, productId)
      : await this.add(customerId, productId);

    return { wishlisted: !isWishlisted, wishlist };
  },

  /**
   * Guest wishlist -> server wishlist merge on login.
   *
   * Union merge, so it is idempotent (re-running adds nothing) and never
   * deletes something the customer favourited on another device.
   * Unknown/unpublished ids are skipped instead of failing the merge.
   */
  async syncGuestProducts(customerId, productIds = []) {
    const requested = [
      ...new Set(
        (Array.isArray(productIds) ? productIds : []).filter(
          (id) => typeof id === "string" && id,
        ),
      ),
    ].slice(0, 200);

    if (requested.length === 0) {
      return { wishlist: await this.get(customerId), skipped: [] };
    }

    const existing = await strapi.documents(PRODUCT_UID).findMany({
      filters: { documentId: { $in: requested } },
      status: "published",
      fields: ["name"],
    });

    const validIds = existing.map((product) => product.documentId);
    const skipped = requested.filter((id) => !validIds.includes(id));

    if (validIds.length > 0) {
      const wishlist = await this.getOrCreate(customerId);

      await strapi.documents(WISHLIST_UID).update({
        documentId: wishlist.documentId,
        data: { products: { connect: validIds } },
      });
    }

    return { wishlist: await this.get(customerId), skipped };
  },
}));
