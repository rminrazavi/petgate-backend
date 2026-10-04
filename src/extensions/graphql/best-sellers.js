"use strict";

const { getProductSalesRanking } = require("../../utils/best-sellers");

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

function clampLimit(value) {
  const n = Number.isInteger(value) ? value : DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, n));
}

module.exports = ({ nexus, strapi }) => ({
  types: [
    nexus.objectType({
      name: "BestSellerProduct",
      definition(t) {
        t.nonNull.id("documentId");
        t.nonNull.string("name");
        t.nonNull.string("slug");
        t.nonNull.int("totalSold");
      },
    }),
    nexus.extendType({
      type: "Query",
      definition(t) {
        t.nonNull.list.nonNull.field("bestSellers", {
          type: "BestSellerProduct",
          args: { limit: nexus.intArg({ default: DEFAULT_LIMIT }) },
          resolve: async (_parent, args) => {
            const ranking = await getProductSalesRanking(strapi);
            return ranking.slice(0, clampLimit(args.limit));
          },
        });
      },
    }),
  ],
  resolversConfig: {
    "Query.bestSellers": { auth: false },
  },
});
