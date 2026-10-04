"use strict";

const { createCoreService } = require("@strapi/strapi").factories;
const {
  EVENT_NAMES,
  DEVICE_TYPES,
  MAX_LENGTHS,
  MAX_PROPERTIES_KEYS,
} = require("../../../utils/analytics-events");

function truncate(value, max) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function inferDeviceType(userAgent) {
  if (!userAgent || typeof userAgent !== "string") return "unknown";
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|(android(?!.*mobile))/.test(ua)) return "tablet";
  if (/mobile|iphone|android|phone/.test(ua)) return "mobile";
  if (/mozilla|chrome|safari|firefox|edg/.test(ua)) return "desktop";
  return "unknown";
}

function sanitizeProperties(properties) {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return undefined;
  }
  const keys = Object.keys(properties).slice(0, MAX_PROPERTIES_KEYS);
  const clean = {};
  for (const key of keys) {
    const value = properties[key];
    // Only keep JSON-safe primitives/plain structures; drop functions,
    // symbols, and anything that fails a basic serialization check.
    try {
      JSON.stringify(value);
      clean[key] = value;
    } catch (_err) {
      // skip unserializable value
    }
  }
  return clean;
}

/**
 * Validates and normalizes a raw event payload from POST /api/analytics/track.
 * Returns { ok: true, data } or { ok: false, reason }.
 * Never throws on bad input — malformed events are rejected, not crashed on.
 */
function buildEventRecord(body, ctx) {
  if (!body || typeof body !== "object") {
    return { ok: false, reason: "EMPTY_PAYLOAD" };
  }

  const eventName = typeof body.eventName === "string" ? body.eventName.trim() : "";
  if (!EVENT_NAMES.includes(eventName)) {
    return { ok: false, reason: "UNKNOWN_EVENT_NAME" };
  }

  const anonymousId = truncate(body.anonymousId, MAX_LENGTHS.anonymousId);
  if (!anonymousId) {
    return { ok: false, reason: "MISSING_ANONYMOUS_ID" };
  }

  const sessionId = truncate(body.sessionId, MAX_LENGTHS.sessionId);
  if (!sessionId) {
    return { ok: false, reason: "MISSING_SESSION_ID" };
  }

  // customerId is trusted only from the payload for now (Phase 1 has no
  // requirement to cross-check it against the authenticated user). Phase 2
  // may want to resolve it from ctx.state.user instead when present.
  const customerId = truncate(body.customerId, MAX_LENGTHS.customerId) || null;

  const occurredAtInput = body.timestamp ? new Date(body.timestamp) : new Date();
  const occurredAt = Number.isNaN(occurredAtInput.getTime()) ? new Date() : occurredAtInput;

  // Never trust a client-supplied user agent over the real request header;
  // fall back to it only if the header is unavailable (rare).
  const userAgent =
    truncate(ctx.request.header["user-agent"], MAX_LENGTHS.userAgent) ||
    truncate(body.userAgent, MAX_LENGTHS.userAgent) ||
    null;

  const deviceTypeInput = typeof body.deviceType === "string" ? body.deviceType : null;
  const deviceType = DEVICE_TYPES.includes(deviceTypeInput)
    ? deviceTypeInput
    : inferDeviceType(userAgent);

  const data = {
    eventName,
    anonymousId,
    sessionId,
    customerId,
    occurredAt,
    pageUrl: truncate(body.pageUrl, MAX_LENGTHS.pageUrl) || null,
    referrer: truncate(body.referrer, MAX_LENGTHS.referrer) || null,
    deviceType,
    userAgent,
    utmSource: truncate(body.utmSource, MAX_LENGTHS.utm) || null,
    utmMedium: truncate(body.utmMedium, MAX_LENGTHS.utm) || null,
    utmCampaign: truncate(body.utmCampaign, MAX_LENGTHS.utm) || null,
    utmContent: truncate(body.utmContent, MAX_LENGTHS.utm) || null,
    utmTerm: truncate(body.utmTerm, MAX_LENGTHS.utm) || null,
    properties: sanitizeProperties(body.properties) || null,
  };

  return { ok: true, data };
}

module.exports = createCoreService("api::analytics-event.analytics-event", () => ({
  async track(body, ctx) {
    const result = buildEventRecord(body, ctx);
    if (!result.ok) return result;

    const entry = await strapi.documents("api::analytics-event.analytics-event").create({
      data: result.data,
    });

    return { ok: true, entry };
  },
}));
