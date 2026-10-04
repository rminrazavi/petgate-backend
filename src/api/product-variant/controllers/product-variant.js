"use strict";

/**
 * product-variant controller
 */

const { createCoreController } = require("@strapi/strapi").factories;

// Auto-generated SKUs are re-checked against the database right before
// each create (see content-types/product-variant/lifecycles.js), and
// `sku` has a DB-level unique constraint (see schema.json) as the hard
// guarantee. Between those two, the only way a create can still fail on
// a SKU collision is a genuine race: two requests both generating the
// same random code and both passing their own pre-check before either
// has inserted yet. That's astronomically unlikely (1 in 36^6 per pair)
// but cheap to make harmless — on that specific failure, retrying the
// same request lets the lifecycle roll a fresh SKU rather than
// surfacing a spurious 500 to the client.
const MAX_CREATE_ATTEMPTS = 3;

function isUniqueSkuViolation(err) {
  const messages = [
    err?.message,
    ...(err?.details?.errors || []).map((e) => e.message),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return messages.includes("sku");
}

module.exports = createCoreController(
  "api::product-variant.product-variant",

  ({ strapi }) => ({
    async create(ctx) {
      for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          return await super.create(ctx);
        } catch (err) {
          const isLastAttempt = attempt === MAX_CREATE_ATTEMPTS;

          if (isLastAttempt || !isUniqueSkuViolation(err)) {
            throw err;
          }
          // else: loop and retry, the lifecycle will roll a new SKU
        }
      }

      return undefined; // unreachable
    },
  }),
);
