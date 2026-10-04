"use strict";

const gateways = require("../gateways");

module.exports = {
  create(name = "sep") {
    const gateway = gateways[name];

    if (!gateway) {
      throw new Error(`Payment gateway "${name}" not found`);
    }

    return gateway;
  },
};