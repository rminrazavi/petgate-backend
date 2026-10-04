const products = require("../data/products");

module.exports = async (strapi) => {
  console.log("📦 Seeding products...");

  for (const item of products) {

    const exists = await strapi
      .documents("api::product.product")
      .findFirst({
        filters: { slug: item.slug },
      });

    if (exists) {
      console.log(`⏩ ${item.name}`);
      continue;
    }

    const brand = await strapi
      .documents("api::brand.brand")
      .findFirst({
        filters: { slug: item.brand },
      });

    const category = await strapi
      .documents("api::category.category")
      .findFirst({
        filters: { slug: item.category },
      });

    await strapi.documents("api::product.product").create({
      data: {
        name: item.name,
        slug: item.slug,
        description: item.description,
        shortDescription: item.shortDescription,
        ageGroup: item.ageGroup,
        brand: brand.documentId,
        category: category.documentId,
        publishedAt: new Date(),
      },
    });

    console.log(`✅ ${item.name}`);
  }
};