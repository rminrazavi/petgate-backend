"use strict";

/**
 * `petType` has been fully removed from the Product content-type
 * (schema.json, service, and GraphQL layer). The pet/animal taxonomy is
 * now represented entirely through the Category hierarchy
 * (Category.parents / Category.children).
 *
 * This migration drops the now-orphaned `pet_type` column from the
 * `products` table. Strapi's dev-mode schema sync does not drop columns
 * on its own (by design, to avoid accidental data loss), so this is
 * required for the database to actually match the new schema in any
 * environment that doesn't go through a fresh `develop` sync (staging,
 * production, or any teammate's DB that already has the old column).
 *
 * Format follows Strapi's documented database migration contract
 * (`database/migrations/*.js` exporting `up(knex)` / `down(knex)`, run
 * through the project's configured `pg` connection — see package.json).
 * `knex.schema` is the Postgres-compatible schema builder Strapi itself
 * uses internally, so this is standard Postgres DDL (`ALTER TABLE ...
 * DROP COLUMN`) generated for the connection already configured for this
 * project, not hand-written SQL guessing at dialect quirks.
 *
 * Idempotent both directions:
 * - up(): guarded with hasColumn — does nothing (no error) if `pet_type`
 *   is already gone, so this is safe to run more than once and safe on
 *   any DB that's already caught up.
 * - down(): guarded with hasColumn — does nothing (no error) if the
 *   column already exists.
 */
module.exports = {
  async up(knex) {
    const hasColumn = await knex.schema.hasColumn("products", "pet_type");

    if (!hasColumn) {
      return; // already dropped (or never existed on this DB) - no-op, not an error
    }

    await knex.schema.alterTable("products", (table) => {
      table.dropColumn("pet_type");
    });
  },

  async down(knex) {
    const hasColumn = await knex.schema.hasColumn("products", "pet_type");

    if (hasColumn) {
      return; // already present - no-op, not an error
    }

    // Best-effort rollback only: recreates the column so the app doesn't
    // crash against the old schema/seed scripts, but does NOT restore:
    //   - the original enumeration CHECK constraint (dog/cat/bird/fish/
    //     rabbit/other) that Strapi generated for the enum field, or
    //   - any data that was in the column before it was dropped.
    // If a real rollback with data is ever needed, restore from a
    // pre-migration DB backup instead of relying on this.
    await knex.schema.alterTable("products", (table) => {
      table.string("pet_type", 255);
    });
  },
};
