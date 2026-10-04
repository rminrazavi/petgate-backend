"use strict";

/**
 * Optional global error handler (registered from config/middlewares.js
 * when a uniform `{ success, code, message }` envelope is wanted).
 *
 * Client errors (4xx) keep their message, because those messages are
 * written for customers and are already localized. Server errors never
 * leak an internal message, stack, SQL fragment or file path to the
 * client — the full error still goes to the server log.
 */
module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      strapi.log.error(err);

      const status = err.status || err.statusCode || 500;

      ctx.status = status;

      ctx.body = {
        success: false,
        code: status >= 500 ? "INTERNAL_SERVER_ERROR" : err.code || "BAD_REQUEST",
        message:
          status >= 500
            ? "خطای داخلی سرور"
            : err.message || "درخواست نامعتبر است",
      };
    }
  };
};
