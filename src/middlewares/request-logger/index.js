"use strict";

module.exports = () => {
  return async (ctx, next) => {
    const start = Date.now();

    await next();

    const ms = Date.now() - start;

    strapi.log.info(`${ctx.method} ${ctx.url} ${ctx.status} ${ms}ms`);
  };
};
