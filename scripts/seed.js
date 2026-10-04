"use strict";

const { createStrapi } = require("@strapi/strapi");

async function bootstrap() {
  const app = await createStrapi();
  await app.load();

  console.log("🌱 Starting seed...");

  try {
    const seedBrands = require("./seeders/brandSeeder");
    const seedCategories = require("./seeders/categorySeeder");
    const seedProducts = require("./seeders/productSeeder");
    const seedVariantes = require("./seeders/variantSeeder");
    const seedInventories = require("./seeders/inventorySeeder");

    await seedBrands(app);
    await seedCategories(app);
    await seedProducts(app);
    await seedInventories(app);
    await seedVariantes(app);

    console.log("✅ Seed completed successfully.");
  } catch (err) {
    console.error(err);
  } finally {
    await app.destroy();
    process.exit(0);
  }
}

bootstrap();
