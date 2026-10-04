"use strict";

/**
 * Two clean-ups, both column drops that Strapi's schema sync will not
 * perform on its own (by design, to avoid accidental data loss) — same
 * contract and guard style as the existing petType migration.
 *
 * 1. Product.sku / Product.price / Product.discountPrice /
 *    Product.expiryDate
 *
 *    ProductVariant is the sellable unit throughout this codebase:
 *    Inventory, CartItem, OrderItem and ProductBundleItem all reference
 *    ProductVariant, and every price the storefront shows is computed
 *    from variant.price / variant.discountPrice by
 *    utils/product-pricing.js. Expiry lives on Inventory (per batch),
 *    which utils/inventory.js treats as the source of truth. The four
 *    Product-level columns were never read by any resolver, service,
 *    lifecycle or seeder — they only made it ambiguous where price,
 *    SKU and expiry actually come from.
 *
 * 2. Otp.code
 *
 *    One-time codes are now stored as salted hashes (Otp.codeHash) so a
 *    database or log dump can no longer be replayed to take over an
 *    account. The plaintext column must not linger with old values in
 *    it.
 *
 * Idempotent in both directions: every statement is guarded with
 * hasColumn, so running it twice (or on a database that is already
 * up to date) is a no-op rather than an error.
 */

const PRODUCT_LEGACY_COLUMNS = [
  "sku",
  "price",
  "discount_price",
  "expiry_date",
];

module.exports = {
  async up(knex) {
    for (const column of PRODUCT_LEGACY_COLUMNS) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await knex.schema.hasColumn("products", column);

      if (exists) {
        // eslint-disable-next-line no-await-in-loop
        await knex.schema.alterTable("products", (table) => {
          table.dropColumn(column);
        });
      }
    }

    const hasOtpCode = await knex.schema.hasColumn("otps", "code");

    if (hasOtpCode) {
      await knex.schema.alterTable("otps", (table) => {
        table.dropColumn("code");
      });
    }
  },

  async down(knex) {
    // Best-effort rollback only: recreates the columns so older code can
    // boot against this database again. It does NOT restore any data
    // (restore from a pre-migration backup if that is ever needed), and
    // deliberately does not recreate Otp.code — reintroducing plaintext
    // OTP storage is not something a rollback should do.
    for (const column of PRODUCT_LEGACY_COLUMNS) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await knex.schema.hasColumn("products", column);

      if (exists) continue;

      // eslint-disable-next-line no-await-in-loop
      await knex.schema.alterTable("products", (table) => {
        if (column === "sku") {
          table.string(column, 255);
        } else if (column === "expiry_date") {
          table.date(column);
        } else {
          table.decimal(column, 10, 2);
        }
      });
    }
  },
};
