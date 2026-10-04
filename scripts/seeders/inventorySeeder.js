const inventories = require("../data/inventories");

module.exports = async (strapi) => {
  console.log("📦 Seeding inventories...");

  for (const item of inventories) {
    const variant = await strapi
      .documents("api::product-variant.product-variant")
      .findFirst({
        filters: {
          sku: item.sku,
        },
      });

    if (!variant) {
      console.log(`❌ Variant not found: ${item.sku}`);
      continue;
    }

    const existing = await strapi
      .documents("api::inventory.inventory")
      .findFirst({
        filters: {
          product_variant: {
            documentId: variant.documentId,
          },
        },
      });

    if (existing) {
      console.log(`⏩ Inventory already exists for ${item.sku}`);
      continue;
    }

    await strapi.documents("api::inventory.inventory").create({
      data: {
        stock: item.stock,
        reserved: item.reserved,
        sold: item.sold,
        product_variant: variant.documentId,
      },
    });

    console.log(`✅ Inventory created for ${item.sku}`);
  }
};
