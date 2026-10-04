const variants = require("../data/variants");

module.exports = async (strapi) => {

  console.log("📦 Seeding variants...");

  for (const item of variants) {

    const exists = await strapi
      .documents("api::product-variant.product-variant")
      .findFirst({
        filters: {
          sku: item.sku,
        },
      });

    if (exists) {
      console.log(`⏩ ${item.sku}`);
      continue;
    }

    const product = await strapi
      .documents("api::product.product")
      .findFirst({
        filters: {
          slug: item.product,
        },
      });

    await strapi
      .documents("api::product-variant.product-variant")
      .create({
        data: {
          sku: item.sku,
          price: item.price,
          discountPrice: item.discountPrice,
          stock: item.stock,
          isDefault: item.isDefault,
          attributes: item.attributes,
          product: product.documentId,
        },
      });

    console.log(`✅ ${item.sku}`);
  }
};