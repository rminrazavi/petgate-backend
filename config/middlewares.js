"use strict";

/**
 * PHASE 6: CORS origins come from the environment.
 *
 * The previous value hardcoded ["http://localhost:3000",
 * "http://localhost:3001"], so a deployed MOPET frontend was blocked in
 * production and the only "fix" was editing source. `*` is never used: every
 * storefront request that matters carries an Authorization header, and a
 * wildcard origin with credentials is both invalid and unsafe.
 *
 *   CORS_ORIGINS  comma-separated allowlist (wins when set)
 *   FRONTEND_URL  single-origin shorthand, also used for canonical links
 *
 * With neither set, only localhost dev origins are allowed — a deployment
 * that forgets to configure this fails closed, it does not open up.
 */
const DEV_ORIGINS = ["http://localhost:3000", "http://localhost:3001"];

function resolveOrigins() {
  const configured = [
    ...String(process.env.CORS_ORIGINS || "").split(","),
    process.env.FRONTEND_URL || "",
  ]
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  const unique = [...new Set(configured)];

  if (unique.includes("*")) {
    throw new Error(
      "CORS_ORIGINS must not contain '*': MOPET sends credentialed requests.",
    );
  }

  if (unique.length > 0) {
    return process.env.NODE_ENV === "production"
      ? unique
      : [...new Set([...unique, ...DEV_ORIGINS])];
  }

  return DEV_ORIGINS;
}

module.exports = [
  "strapi::logger",
  "strapi::errors",

  // Uniform { success, code, message } envelope. 4xx keep their localized
  // customer-facing message; 5xx never leak an internal message or stack.
  // Previously defined but registered nowhere, so the storefront could still
  // receive a raw Strapi error shape on a 500.
  "global::error-handler",

  "strapi::security",

  {
    name: "strapi::cors",
    config: {
      origin: resolveOrigins(),
      headers: ["Content-Type", "Authorization", "Origin", "Accept"],
      credentials: true,
    },
  },

  "strapi::poweredBy",

  "strapi::query",

  {
    name: "strapi::body",
    config: {
      jsonLimit: "10mb",
      formLimit: "10mb",
      textLimit: "10mb",
    },
  },

  "strapi::session",

  "strapi::favicon",

  "strapi::public",
];

module.exports.__internal = { resolveOrigins, DEV_ORIGINS };
