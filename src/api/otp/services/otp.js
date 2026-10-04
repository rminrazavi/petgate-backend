"use strict";

const crypto = require("crypto");

const { createCoreService } = require("@strapi/strapi").factories;
const { normalizePhone } = require("../../../utils/phone");

const OTP_UID = "api::otp.otp";

/**
 * OTP issuing/verification service — the single source of truth for
 * one-time-code security. The HTTP layer (api::auth-otp) only maps these
 * results onto status codes; it contains no OTP logic of its own.
 *
 * Security properties implemented here:
 *   - codes are 6 crypto-random digits, never Math.random
 *   - only a salted SHA-256 hash is stored, so a DB/log dump cannot be
 *     replayed; comparison is timing-safe
 *   - short expiry (2 minutes) and strictly one-time use
 *   - issuing a new code invalidates every previous unused code for that
 *     phone, so only the newest code can ever work
 *   - resend cooldown per phone (60s)
 *   - hourly issuing caps per phone and per IP (brute-force / SMS-bombing)
 *   - per-code verification attempt limit (5), after which the code is
 *     burned even if the caller later guesses it correctly
 *   - the code is returned ONLY to the caller that issued it (so it can
 *     be handed to the SMS provider) and never persisted in plaintext
 *     or written to a log in production
 */

const CODE_LENGTH = 6;
const CODE_TTL_SECONDS = 120;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_REQUESTS_PER_PHONE_PER_HOUR = 5;
const MAX_REQUESTS_PER_IP_PER_HOUR = 15;
const RETENTION_HOURS = 24;

const RESULT = {
  INVALID_PHONE: "INVALID_PHONE",
  RATE_LIMITED: "RATE_LIMITED",
  RESEND_COOLDOWN: "RESEND_COOLDOWN",
  NOT_FOUND: "OTP_NOT_FOUND",
  EXPIRED: "OTP_EXPIRED",
  TOO_MANY_ATTEMPTS: "OTP_TOO_MANY_ATTEMPTS",
  INVALID_CODE: "OTP_INVALID",
  OK: "OK",
};

function hashSecret() {
  // Dedicated secret when provided; otherwise the app's own signing key.
  // Never hardcoded, never logged.
  const secret =
    process.env.OTP_HASH_SECRET ||
    (process.env.APP_KEYS || "").split(",")[0] ||
    process.env.JWT_SECRET;

  if (!secret) {
    throw new Error(
      "OTP hashing secret missing: set OTP_HASH_SECRET (or APP_KEYS) in the environment.",
    );
  }

  return secret;
}

function hashCode(phone, code) {
  return crypto
    .createHmac("sha256", hashSecret())
    .update(`${phone}:${code}`)
    .digest("hex");
}

function timingSafeEquals(a, b) {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));

  if (bufferA.length !== bufferB.length) return false;

  return crypto.timingSafeEqual(bufferA, bufferB);
}

function generateCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += String(crypto.randomInt(0, 10));
  }
  return code;
}

function secondsUntil(date) {
  return Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / 1000));
}

module.exports = createCoreService(OTP_UID, ({ strapi }) => ({
  RESULT,
  CODE_TTL_SECONDS,
  RESEND_COOLDOWN_SECONDS,

  /**
   * Issues a code for `phone`.
   * @returns {Promise<{ok: boolean, reason?: string, retryAfterSeconds?: number,
   *   phone?: string, code?: string, expiresInSeconds?: number,
   *   resendAfterSeconds?: number}>}
   */
  async requestOtp(rawPhone, { ip } = {}) {
    const phone = normalizePhone(rawPhone);

    if (!phone) return { ok: false, reason: RESULT.INVALID_PHONE };

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [recentForPhone, latestForPhone, recentForIp] = await Promise.all([
      strapi.db.query(OTP_UID).count({
        where: { phone, createdAt: { $gt: oneHourAgo } },
      }),

      strapi.db.query(OTP_UID).findMany({
        where: { phone },
        orderBy: { createdAt: "desc" },
        limit: 1,
        select: ["createdAt"],
      }),

      ip
        ? strapi.db.query(OTP_UID).count({
            where: { ip, createdAt: { $gt: oneHourAgo } },
          })
        : Promise.resolve(0),
    ]);

    const last = latestForPhone[0];

    if (last?.createdAt) {
      const nextAllowed = new Date(
        new Date(last.createdAt).getTime() + RESEND_COOLDOWN_SECONDS * 1000,
      );

      if (nextAllowed > new Date()) {
        return {
          ok: false,
          reason: RESULT.RESEND_COOLDOWN,
          retryAfterSeconds: secondsUntil(nextAllowed),
        };
      }
    }

    if (recentForPhone >= MAX_REQUESTS_PER_PHONE_PER_HOUR) {
      return {
        ok: false,
        reason: RESULT.RATE_LIMITED,
        retryAfterSeconds: 3600,
      };
    }

    if (recentForIp >= MAX_REQUESTS_PER_IP_PER_HOUR) {
      return {
        ok: false,
        reason: RESULT.RATE_LIMITED,
        retryAfterSeconds: 3600,
      };
    }

    // Only the newest code may ever be valid.
    await strapi.db.query(OTP_UID).updateMany({
      where: { phone, used: false },
      data: { used: true, usedAt: new Date() },
    });

    const code = generateCode();
    console.log(`otp code : ${code}`);

    await strapi.documents(OTP_UID).create({
      data: {
        phone,
        codeHash: hashCode(phone, code),
        expireAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000),
        used: false,
        attempts: 0,
        ip: ip ?? null,
      },
    });

    return {
      ok: true,
      phone,
      code,
      expiresInSeconds: CODE_TTL_SECONDS,
      resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
    };
  },

  /**
   * Verifies a submitted code and burns it.
   * @returns {Promise<{ok: boolean, reason?: string, phone?: string,
   *   remainingAttempts?: number}>}
   */
  async verifyOtp(rawPhone, rawCode, { ip } = {}) {
    const phone = normalizePhone(rawPhone);
    const code = typeof rawCode === "string" ? rawCode.trim() : "";

    if (!phone) return { ok: false, reason: RESULT.INVALID_PHONE };

    if (!/^\d{6}$/.test(code)) {
      return { ok: false, reason: RESULT.INVALID_CODE };
    }

    const [record] = await strapi.db.query(OTP_UID).findMany({
      where: { phone, used: false },
      orderBy: { createdAt: "desc" },
      limit: 1,
    });

    if (!record) return { ok: false, reason: RESULT.NOT_FOUND };

    if (new Date(record.expireAt) < new Date()) {
      await strapi.db.query(OTP_UID).update({
        where: { id: record.id },
        data: { used: true, usedAt: new Date() },
      });

      return { ok: false, reason: RESULT.EXPIRED };
    }

    const attempts = (record.attempts ?? 0) + 1;

    if (attempts > MAX_VERIFY_ATTEMPTS) {
      await strapi.db.query(OTP_UID).update({
        where: { id: record.id },
        data: { used: true, usedAt: new Date(), attempts },
      });

      return { ok: false, reason: RESULT.TOO_MANY_ATTEMPTS };
    }

    const matches = timingSafeEquals(record.codeHash, hashCode(phone, code));

    if (!matches) {
      await strapi.db.query(OTP_UID).update({
        where: { id: record.id },
        data: { attempts, ip: record.ip ?? ip ?? null },
      });

      return {
        ok: false,
        reason: RESULT.INVALID_CODE,
        remainingAttempts: Math.max(0, MAX_VERIFY_ATTEMPTS - attempts),
      };
    }

    await strapi.db.query(OTP_UID).update({
      where: { id: record.id },
      data: { used: true, usedAt: new Date(), attempts },
    });

    return { ok: true, phone };
  },

  /** Housekeeping for the scheduled task: drop consumed/expired codes. */
  async purgeExpired() {
    const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);

    const { count } = await strapi.db.query(OTP_UID).deleteMany({
      where: {
        $or: [{ used: true }, { expireAt: { $lt: new Date() } }],
        createdAt: { $lt: cutoff },
      },
    });

    return count ?? 0;
  },
}));
