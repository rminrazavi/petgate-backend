"use strict";

/**
 * Phase 1 event catalogue.
 *
 * Event names are validated against this allowlist in the service layer
 * rather than as a Strapi `enumeration` attribute, so new events can be
 * added in Phase 2+ without a content-type migration/DB alter — just add
 * the name here.
 */
const EVENT_NAMES = [
  "page_view",
  "product_view",
  "product_list_view",
  "category_view",
  "search",
  "search_result_click",
  "brand_view",
  "add_to_cart",
  "remove_from_cart",
  "wishlist_add",
  "wishlist_remove",
  "begin_checkout",
  "purchase",
];

const DEVICE_TYPES = ["desktop", "mobile", "tablet", "unknown"];

// Defensive caps so a malformed/abusive payload can't write unbounded
// text into the DB. Values are truncated, never rejected, to keep the
// endpoint fail-silent-friendly for the client.
const MAX_LENGTHS = {
  anonymousId: 100,
  sessionId: 100,
  customerId: 100,
  pageUrl: 2048,
  referrer: 2048,
  userAgent: 512,
  utm: 255,
};

// Hard cap on the free-form `properties` JSON payload (event-specific
// context such as productId, searchQuery, categorySlug). Prevents a
// single event from becoming a dumping ground for large objects.
const MAX_PROPERTIES_KEYS = 20;

module.exports = {
  EVENT_NAMES,
  DEVICE_TYPES,
  MAX_LENGTHS,
  MAX_PROPERTIES_KEYS,
};
