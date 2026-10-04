"use strict";

const authenticated = { auth: { strategies: ["users-permissions"] } };

module.exports = {
  routes: [
    {
      method: "GET",
      path: "/notifications/unread-count",
      handler: "api::notification.notification.unreadCount",
      config: authenticated,
    },
  ],
};
