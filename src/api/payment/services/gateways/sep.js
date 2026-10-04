"use strict";

const https = require("node:https");

const TOKEN_URL = process.env.SEP_TOKEN_URL || "https://sep.shaparak.ir/Payments/InitPayment.asmx";
const VERIFY_URL = process.env.SEP_VERIFY_URL || "https://sep.shaparak.ir/payments/referencepayment.asmx";
const PAYMENT_URL = process.env.SEP_PAYMENT_URL || "https://sep.shaparak.ir/OnlinePG/OnlinePG";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function firstXmlValue(xml, names) {
  for (const name of names) {
    const match = xml.match(new RegExp(`<[^>]*${name}[^>]*>([\\s\\S]*?)</[^>]*${name}>`, "i"));
    if (match) return match[1].replace(/<[^>]+>/g, "").trim();
  }
  return null;
}

function scalarOrXmlValue(xml, names) {
  const wrapped = firstXmlValue(xml, names);
  if (wrapped !== null) return wrapped;
  const stripped = String(xml).replace(/<[^>]+>/g, "").trim();
  return stripped || null;
}

function postSoap(url, action, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = `<?xml version="1.0" encoding="utf-8"?>` +
      `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;
    const request = https.request({
      hostname: target.hostname, port: target.port || 443,
      path: `${target.pathname}${target.search}`, method: "POST",
      timeout: Number(process.env.SEP_TIMEOUT_MS || 15000),
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${action}"`, "Content-Length": Buffer.byteLength(payload) },
    }, (response) => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { data += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`SEP request failed with HTTP ${response.statusCode}`));
        resolve(data);
      });
    });
    request.on("timeout", () => request.destroy(new Error("SEP request timed out")));
    request.on("error", reject);
    request.write(payload); request.end();
  });
}

function integerAmount(amount) {
  const value = Number(amount);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("SEP amount must be a positive integer");
  return value;
}

module.exports = {
  async requestPayment({ amount, orderId, callbackURL }) {
    const terminalId = required("SEP_TERMINAL_ID");
    const totalAmount = integerAmount(amount);
    if (!orderId || !callbackURL) throw new Error("SEP payment parameters are incomplete");
    const body = `<RequestToken xmlns="http://tempuri.org/"><strMID>${escapeXml(terminalId)}</strMID>` +
      `<strResNum>${escapeXml(orderId)}</strResNum><strTotalAmount>${totalAmount}</strTotalAmount>` +
      `<strRedirectURL>${escapeXml(callbackURL)}</strRedirectURL></RequestToken>`;
    const xml = await postSoap(TOKEN_URL, "RequestToken", body);
    const token = scalarOrXmlValue(xml, ["RequestTokenResult", "Token"]);
    if (!token || (/^-?\d+$/.test(token) && Number(token) <= 0)) throw new Error("SEP did not return a valid payment token");
    return { providerToken: token, url: PAYMENT_URL, method: "POST", fields: { Token: token }, resNum: orderId };
  },

  async verifyPayment({ referenceId, amount }) {
    const terminalId = required("SEP_TERMINAL_ID");
    const expectedAmount = integerAmount(amount);
    if (!referenceId) throw new Error("SEP reference ID is required");
    const body = `<VerifyTransaction xmlns="http://tempuri.org/"><RefNum>${escapeXml(referenceId)}</RefNum>` +
      `<MID>${escapeXml(terminalId)}</MID></VerifyTransaction>`;
    const xml = await postSoap(VERIFY_URL, "VerifyTransaction", body);
    const verifiedAmount = Number(scalarOrXmlValue(xml, ["VerifyTransactionResult", "Amount"]));
    if (!Number.isFinite(verifiedAmount) || verifiedAmount !== expectedAmount) throw new Error("SEP verification amount mismatch");
    return { success: true, referenceId, verifiedAmount, raw: xml };
  },
};
