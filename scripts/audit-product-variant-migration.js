"use strict";

/**
 * Phase 2 data verification — READ-ONLY.
 *
 * Runs the 9 checks requested for the Product -> ProductVariant
 * commercial-data cleanup, before any further (destructive) migration
 * step is approved. This script performs NO create/update/delete calls
 * of any kind — every query below is a find/count.
 *
 * Usage:
 *   node scripts/audit-product-variant-migration.js
 *
 * Follows the same bootstrap pattern as scripts/seed.js.
 *
 * Uses the low-level strapi.db.query engine (not the Document Service)
 * for the Product-level field checks (1-4), matching the existing
 * convention in src/utils/sku.js ("checks every physical row — draft
 * and published alike"). Product has draftAndPublish: true, so a single
 * document can have up to two physical rows; this script reports both.
 */

const { createStrapi } = require("@strapi/strapi");

const PRODUCT_UID = "api::product.product";
const VARIANT_UID = "api::product-variant.product-variant";
const INVENTORY_UID = "api::inventory.inventory";

const SAMPLE_LIMIT = 20;

function printSection(title) {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

function printRows(rows, mapRow) {
  console.log(`Count: ${rows.length}`);
  if (rows.length === 0) return;

  const shown = rows.slice(0, SAMPLE_LIMIT);
  for (const row of shown) {
    console.log("  -", JSON.stringify(mapRow ? mapRow(row) : row));
  }
  if (rows.length > SAMPLE_LIMIT) {
    console.log(`  ... and ${rows.length - SAMPLE_LIMIT} more (truncated)`);
  }
}

async function run() {
  const app = await createStrapi();
  await app.load();

  console.log("Phase 2 data verification (READ-ONLY — no writes performed)");

  try {
    // ---- 1-4: Product-level legacy commercial fields still populated? ----
    printSection("1. Products with Product.price != null");
    const productsWithPrice = await app.db.query(PRODUCT_UID).findMany({
      where: { price: { $notNull: true } },
      select: ["documentId", "name", "price", "publishedAt"],
    });
    printRows(productsWithPrice, (p) => ({
      documentId: p.documentId,
      name: p.name,
      price: p.price,
      status: p.publishedAt ? "published" : "draft",
    }));

    printSection("2. Products with Product.discountPrice != null");
    const productsWithDiscountPrice = await app.db.query(PRODUCT_UID).findMany({
      where: { discountPrice: { $notNull: true } },
      select: ["documentId", "name", "discountPrice", "publishedAt"],
    });
    printRows(productsWithDiscountPrice, (p) => ({
      documentId: p.documentId,
      name: p.name,
      discountPrice: p.discountPrice,
      status: p.publishedAt ? "published" : "draft",
    }));

    printSection("3. Products with Product.sku != null");
    const productsWithSku = await app.db.query(PRODUCT_UID).findMany({
      where: { sku: { $notNull: true } },
      select: ["documentId", "name", "sku", "publishedAt"],
    });
    printRows(productsWithSku, (p) => ({
      documentId: p.documentId,
      name: p.name,
      sku: p.sku,
      status: p.publishedAt ? "published" : "draft",
    }));

    printSection("4. Products with Product.expiryDate != null");
    const productsWithExpiryDate = await app.db.query(PRODUCT_UID).findMany({
      where: { expiryDate: { $notNull: true } },
      select: ["documentId", "name", "expiryDate", "publishedAt"],
    });
    printRows(productsWithExpiryDate, (p) => ({
      documentId: p.documentId,
      name: p.name,
      expiryDate: p.expiryDate,
      status: p.publishedAt ? "published" : "draft",
    }));

    // ---- 5 & 6: variant coverage ----
    const allProducts = await app.db.query(PRODUCT_UID).findMany({
      select: ["documentId", "name", "publishedAt"],
      populate: {
        variants: {
          select: ["documentId", "isActive", "price"],
        },
      },
    });

    printSection("5. Products without any variant");
    const productsWithoutVariants = allProducts.filter(
      (p) => !p.variants || p.variants.length === 0,
    );
    printRows(productsWithoutVariants, (p) => ({
      documentId: p.documentId,
      name: p.name,
      status: p.publishedAt ? "published" : "draft",
    }));

    printSection(
      "6. Published products without an active, validly-priced variant",
    );
    const hasValidPrice = (v) =>
      v.price !== null && v.price !== undefined && Number(v.price) > 0;
    const publishedWithoutPublishableVariant = allProducts.filter(
      (p) =>
        p.publishedAt &&
        !(p.variants || []).some((v) => v.isActive && hasValidPrice(v)),
    );
    printRows(publishedWithoutPublishableVariant, (p) => ({
      documentId: p.documentId,
      name: p.name,
      variantCount: (p.variants || []).length,
    }));
    if (publishedWithoutPublishableVariant.length > 0) {
      console.log(
        "  NOTE: these products are already published without satisfying " +
          "the Phase 1 publish rule. This is expected if they existed " +
          "before Phase 1 shipped (the rule only gates the `publish` " +
          "action going forward — it does not retroactively unpublish " +
          "anything), or if they were created via `create()` with " +
          "`publishedAt` set directly (e.g. scripts/seeders/productSeeder.js), " +
          "which is a different Document Service action than `publish` and " +
          "is NOT covered by src/document-middlewares/product-publish-validation.js. " +
          "See the Phase 2 report, section 3, for details — this is a real " +
          "gap, not a bug in this script.",
      );
    }

    // ---- 7 & 9: variant-level checks ----
    const allVariants = await app.db.query(VARIANT_UID).findMany({
      select: ["documentId", "sku", "isActive", "price"],
    });

    printSection("7. Active variants without a valid price");
    const activeInvalidPriceVariants = allVariants.filter(
      (v) => v.isActive && !hasValidPrice(v),
    );
    printRows(activeInvalidPriceVariants, (v) => ({
      documentId: v.documentId,
      sku: v.sku,
      price: v.price,
    }));

    printSection("9. Duplicate Variant SKUs");
    const bySku = new Map();
    for (const v of allVariants) {
      if (!v.sku) continue;
      if (!bySku.has(v.sku)) bySku.set(v.sku, []);
      bySku.get(v.sku).push(v.documentId);
    }
    const duplicateSkus = [...bySku.entries()].filter(
      ([, ids]) => ids.length > 1,
    );
    console.log(`Count: ${duplicateSkus.length}`);
    for (const [sku, ids] of duplicateSkus.slice(0, SAMPLE_LIMIT)) {
      console.log(`  - sku=${sku} documentIds=${JSON.stringify(ids)}`);
    }
    if (duplicateSkus.length > SAMPLE_LIMIT) {
      console.log(
        `  ... and ${duplicateSkus.length - SAMPLE_LIMIT} more (truncated)`,
      );
    }
    if (duplicateSkus.length > 0) {
      console.log(
        "  NOTE: ProductVariant.sku has a DB-level unique constraint " +
          "(schema.json), so duplicates here would mean the constraint " +
          "was bypassed (e.g. a raw import) rather than created through " +
          "normal create/update — worth investigating how they got in.",
      );
    }

    // ---- 8: variants without inventory ----
    printSection("8. Variants without inventory");
    const variantsWithInventory = await app.db.query(VARIANT_UID).findMany({
      select: ["documentId", "sku"],
      populate: { inventories: { select: ["documentId"] } },
    });
    const variantsWithoutInventory = variantsWithInventory.filter(
      (v) => !v.inventories || v.inventories.length === 0,
    );
    printRows(variantsWithoutInventory, (v) => ({
      documentId: v.documentId,
      sku: v.sku,
    }));

    console.log("\nDone. No data was modified by this script.");
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await app.destroy();
    process.exit(process.exitCode || 0);
  }
}

run();
