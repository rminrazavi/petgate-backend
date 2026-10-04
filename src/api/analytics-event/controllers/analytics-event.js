"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController(
  "api::analytics-event.analytics-event",
  ({ strapi }) => ({
    /**
     * POST /api/analytics/track
     * Public endpoint (anonymous + authenticated). Single event per call
     * for Phase 1 — batching can be added later without changing the shape.
     */
    async track(ctx) {
      const body = ctx.request.body;

      let result;
      try {
        result = await strapi
          .service("api::analytics-event.analytics-event")
          .track(body, ctx);
      } catch (err) {
        // Analytics must never surface a 5xx that a caller would treat as
        // meaningful — log for ops, respond generically.
        strapi.log.error(`[analytics] track failed unexpectedly: ${err.message}`);
        ctx.status = 202;
        ctx.body = { success: false };
        return;
      }

      if (!result.ok) {
        ctx.status = 400;
        ctx.body = { success: false, reason: result.reason };
        return;
      }

      ctx.status = 202;
      ctx.body = { success: true };
    },
  }),
);
