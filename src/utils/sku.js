"use strict";

/**
 * ProductVariant SKU generator.
 *
 * SKU belongs to ProductVariant, not Product: the variant is the
 * sellable unit everywhere in this codebase (Inventory, CartItem,
 * OrderItem and ProductBundleItem all reference ProductVariant, never
 * Product).
 *
 * Format: MOP-XXXXXX, e.g. "MOP-7K4X92".
 *   - Fixed brand prefix so SKUs are recognisable in the admin panel.
 *   - 6 characters from an unambiguous alphabet (no I/L/O/U, no 0/1) so
 *     they can be read aloud, typed, or printed on a label without
 *     transcription mistakes.
 *   - Random, never sequential: a SKU must not leak a database id or
 *     the size of the catalogue.
 *   - Generated with crypto.randomInt (uniform, unpredictable) rather
 *     than Math.random.
 *
 * 30^6 (~729 million) codes, checked against the database before use,
 * with the schema's `unique: true` constraint as the hard backstop and
 * a controller-level retry for the vanishingly rare insert race (see
 * controllers/product-variant.js).
 */

const crypto = require("crypto");

const PREFIX = "MOP-";
const RANDOM_LENGTH = 6;
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const MAX_ATTEMPTS = 20;

function randomSkuSuffix() {
  let suffix = "";
  for (let i = 0; i < RANDOM_LENGTH; i += 1) {
    suffix += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return suffix;
}

function generateSkuCandidate() {
  return `${PREFIX}${randomSkuSuffix()}`;
}

/**
 * Generates a SKU that doesn't currently exist on any row of `uid`.
 * Uses the query engine (not the Document Service) so it checks every
 * physical row — draft and published alike.
 */
async function getUniqueSku(strapi, { uid }) {
  if (!uid) {
    throw new Error("getUniqueSku: `uid` is required.");
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = generateSkuCandidate();

    // eslint-disable-next-line no-await-in-loop
    const existing = await strapi.db.query(uid).findOne({
      where: { sku: candidate },
      select: ["id"],
    });

    if (!existing) return candidate;
  }

  throw new Error(
    `Could not generate a unique variant SKU after ${MAX_ATTEMPTS} attempts.`,
  );
}

module.exports = { generateSkuCandidate, getUniqueSku, PREFIX };
