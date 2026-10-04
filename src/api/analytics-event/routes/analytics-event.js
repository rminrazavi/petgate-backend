"use strict";

// Intentionally NOT createCoreRouter(): analytics events are write-only
// from the client's perspective. There is no public find/findOne/update/
// delete — only the admin Content Manager (which bypasses the REST API
// permissions) can browse them. This avoids ever having to remember to
// lock down auto-generated CRUD routes for a high-volume, publicly
// writable collection.
module.exports = {
  routes: [
    {
      method: "POST",
      path: "/analytics/track",
      handler: "api::analytics-event.analytics-event.track",
      config: {
        auth: false,
        // Body can be sent via fetch(keepalive) or navigator.sendBeacon,
        // the latter of which typically POSTs a Blob — both arrive as
        // JSON here as long as the client sets a JSON content type.
        policies: [],
        middlewares: [],
      },
    },
  ],
};
