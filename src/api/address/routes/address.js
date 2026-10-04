"use strict";

const authenticated = { auth: { strategies: ["users-permissions"] } };

module.exports = {
  routes: [
    { method: "GET", path: "/addresses", handler: "api::address.address.mine", config: authenticated },
    { method: "POST", path: "/addresses", handler: "api::address.address.createMine", config: authenticated },
    { method: "PUT", path: "/addresses/:id", handler: "api::address.address.updateMine", config: authenticated },
    { method: "DELETE", path: "/addresses/:id", handler: "api::address.address.deleteMine", config: authenticated },
  ],
};
