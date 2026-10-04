"use strict";

/**
 * Product.category replaced the contradictory legacy Product.categories
 * declaration. Preserve the existing relation rows when Strapi changes the
 * generated join-table name from plural to singular.
 */
module.exports = {
  async up(knex) {
    const oldTable = "products_categories_lnk";
    const newTable = "products_category_lnk";
    const hasOld = await knex.schema.hasTable(oldTable);
    const hasNew = await knex.schema.hasTable(newTable);

    if (hasOld && !hasNew) {
      await knex.schema.renameTable(oldTable, newTable);
    }
  },

  async down(knex) {
    const oldTable = "products_categories_lnk";
    const newTable = "products_category_lnk";
    const hasOld = await knex.schema.hasTable(oldTable);
    const hasNew = await knex.schema.hasTable(newTable);

    if (hasNew && !hasOld) {
      await knex.schema.renameTable(newTable, oldTable);
    }
  },
};
