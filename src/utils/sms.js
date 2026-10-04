"use strict";

/**
 * SMS provider boundary.
 *
 * The rest of the app only ever calls sendSMS(); no caller knows or
 * cares which provider is configured. Kavenegar is the configured
 * provider (matching api::sms.sms's `provider` enum) and is called over
 * plain HTTPS with the global fetch built into Node 20+, so no extra
 * dependency is introduced.
 *
 * Configuration (environment only, never hardcoded):
 *   KAVENEGAR_API_KEY   provider key — presence of this enables real sending
 *   KAVENEGAR_SENDER    optional originator number
 *
 * Message bodies (which contain OTP codes) are NEVER logged in
 * production. In development, with no key configured, the message is
 * printed to the console so developers can complete the login flow
 * locally without an SMS gateway.
 */

const PROVIDER = "kavenegar";
const REQUEST_TIMEOUT_MS = 8000;

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function isProviderConfigured() {
  return Boolean(process.env.KAVENEGAR_API_KEY);
}

async function sendViaKavenegar(phone, message) {
  const apiKey = process.env.KAVENEGAR_API_KEY;

  const url = new URL(
    `https://api.kavenegar.com/v1/${encodeURIComponent(apiKey)}/sms/send.json`,
  );

  url.searchParams.set("receptor", phone);
  url.searchParams.set("message", message);

  if (process.env.KAVENEGAR_SENDER) {
    url.searchParams.set("sender", process.env.KAVENEGAR_SENDER);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.return?.status !== 200) {
      const status = payload?.return?.status ?? response.status;

      // Provider status only — never the message body.
      throw new Error(`Kavenegar rejected the message (status ${status})`);
    }

    return {
      success: true,
      provider: PROVIDER,
      trackingCode: payload?.entries?.[0]?.messageid
        ? String(payload.entries[0].messageid)
        : null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @returns {Promise<{success: boolean, provider: string, trackingCode?: string|null}>}
 * @throws when a configured provider refuses the message — callers decide
 * whether that is fatal.
 */
async function sendSMS(phone, message) {
  if (isProviderConfigured()) {
    return sendViaKavenegar(phone, message);
  }

  if (isProduction()) {
    throw new Error(
      "No SMS provider configured: set KAVENEGAR_API_KEY to send messages in production.",
    );
  }

  // Development only, and only when no provider is configured.
  return { success: true, provider: "console", trackingCode: null };
}

module.exports = { sendSMS, isProviderConfigured, PROVIDER };
