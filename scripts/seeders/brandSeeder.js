const brands = require('../data/brands');

module.exports = async (strapi) => {
  console.log('📦 Seeding brands...');

  for (const brand of brands) {
    const existing = await strapi.documents('api::brand.brand').findFirst({
      filters: {
        slug: brand.slug,
      },
    });

    if (existing) {
      console.log(`⏩ ${brand.name} already exists`);
      continue;
    }

    await strapi.documents('api::brand.brand').create({
      data: {
        ...brand,
        publishedAt: new Date(),
      },
    });

    console.log(`✅ ${brand.name}`);
  }
};