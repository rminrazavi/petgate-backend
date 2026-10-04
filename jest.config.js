"use strict";

module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  // These tests are pure unit tests against strapi mocks — no real
  // Strapi instance, DB, or bootstrap involved (see tests/README.md).
  testPathIgnorePatterns: ["/node_modules/", "/.tmp/", "/dist/", "/build/"],
};
