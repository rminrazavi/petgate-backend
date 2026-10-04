"use strict";

const assert = require("node:assert/strict");
const sep = require("../src/api/payment/services/gateways/sep");
const factory = require("../src/api/payment/services/factories/payment-gateway-factory");

(async () => {
  process.env.SEP_TERMINAL_ID = "test-terminal";
  process.env.SEP_CALLBACK_URL = "https://example.test/api/payment/callback";
  assert.equal(factory.create("sep"), sep);
  assert.throws(() => factory.create("zarinpal"));
  await assert.rejects(sep.requestPayment({ amount: 0, orderId: "o1", callbackURL: process.env.SEP_CALLBACK_URL }), /positive integer/);
  await assert.rejects(sep.requestPayment({ amount: 10.5, orderId: "o1", callbackURL: process.env.SEP_CALLBACK_URL }));
  await assert.rejects(sep.verifyPayment({ referenceId: "", amount: 100 }));
  await assert.rejects(sep.verifyPayment({ referenceId: "r1", amount: -1 }), /positive integer/);
  console.log("SEP contract checks: 5 passed / 0 failed");
})().catch((error) => { console.error(error); process.exit(1); });
