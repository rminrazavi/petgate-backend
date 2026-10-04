"use strict";

const crypto = require("crypto");

const { sendSMS, isProviderConfigured } = require("../../../utils/sms");
const { normalizePhone } = require("../../../utils/phone");

const OTP_UID = "api::otp.otp";
const CUSTOMER_UID = "api::customer.customer";
const USER_UID = "plugin::users-permissions.user";

/**
 * OTP authentication HTTP layer.
 *
 * All OTP security (expiry, one-time use, hashing, attempt limits, resend
 * cooldown, per-phone/per-IP caps) lives in api::otp.otp's service — this
 * controller only maps its results onto HTTP semantics, resolves the
 * User/Customer pair, and issues a token. There is exactly one
 * authentication mechanism: Strapi's own users-permissions JWT.
 */

const MESSAGES = {
  INVALID_PHONE: "شماره موبایل معتبر نیست.",
  RATE_LIMITED: "تعداد درخواست‌ها زیاد است. کمی بعد تلاش کنید.",
  RESEND_COOLDOWN: "برای ارسال مجدد کد کمی صبر کنید.",
  OTP_NOT_FOUND: "کدی برای این شماره ارسال نشده است.",
  OTP_EXPIRED: "کد تایید منقضی شده است.",
  OTP_TOO_MANY_ATTEMPTS: "تعداد تلاش‌های ناموفق زیاد است. کد جدید بگیرید.",
  OTP_INVALID: "کد تایید اشتباه است.",
  SMS_FAILED: "ارسال پیامک ناموفق بود. کمی بعد تلاش کنید.",
};

function sanitizeUser(user) {
  if (!user) return null;

  // Never echo the whole user row: it carries the password hash and the
  // reset/confirmation tokens.
  return {
    id: user.id,
    username: user.username,
    phone: user.phone ?? null,
    confirmed: Boolean(user.confirmed),
  };
}

function sanitizeCustomer(customer) {
  if (!customer) return null;

  return {
    documentId: customer.documentId,
    firstName: customer.firstName ?? null,
    lastName: customer.lastName ?? null,
    phone: customer.phone ?? null,
    points: customer.points ?? 0,
    vipLevel: customer.vipLevel ?? null,
  };
}

async function findOrCreateUser(strapi, phone) {
  const existing = await strapi.db.query(USER_UID).findOne({
    where: { phone },
  });

  if (existing) return existing;

  const pluginStore = strapi.store({
    type: "plugin",
    name: "users-permissions",
  });

  const settings = await pluginStore.get({ key: "advanced" });

  const defaultRole = await strapi.db
    .query("plugin::users-permissions.role")
    .findOne({ where: { type: settings.default_role } });

  if (!defaultRole) {
    throw new Error("Default users-permissions role is not configured");
  }

  return strapi
    .plugin("users-permissions")
    .service("user")
    .add({
      username: phone,
      phone,
      // Phone accounts authenticate by OTP only. A random password means
      // the local password strategy can never be used against them.
      password: crypto.randomBytes(32).toString("hex"),
      email: `${phone}@otp.mopet.local`,
      role: defaultRole.id,
      confirmed: true,
      blocked: false,
      provider: "local",
    });
}

async function findOrCreateCustomer(strapi, user, phone) {
  const existing = await strapi.documents(CUSTOMER_UID).findFirst({
    filters: { users_permissions_user: { id: user.id } },
  });

  if (existing) {
    if (!existing.phone) {
      return strapi.documents(CUSTOMER_UID).update({
        documentId: existing.documentId,
        data: { phone },
      });
    }

    return existing;
  }

  return strapi.documents(CUSTOMER_UID).create({
    data: { phone, users_permissions_user: user.id },
  });
}

async function issueToken(strapi, ctx, user) {
  const jwtManagementMode = strapi.config.get(
    "plugin::users-permissions.jwtManagement",
    "legacy",
  );

  if (jwtManagementMode !== "refresh") {
    return strapi
      .plugin("users-permissions")
      .service("jwt")
      .issue({ id: user.id });
  }

  const refresh = await strapi
    .sessionManager("users-permissions")
    .generateRefreshToken(String(user.id), undefined, { type: "refresh" });

  const access = await strapi
    .sessionManager("users-permissions")
    .generateAccessToken(refresh.token);

  if ("error" in access) {
    throw new Error("Unable to issue an access token");
  }

  const sessions = strapi.config.get("plugin::users-permissions.sessions");

  if (sessions?.httpOnly) {
    const cookieName = sessions.cookie?.name || "strapi_up_refresh";
    const isProduction = process.env.NODE_ENV === "production";

    ctx.cookies.set(cookieName, refresh.token, {
      httpOnly: true,
      secure:
        typeof sessions.cookie?.secure === "boolean"
          ? sessions.cookie.secure
          : isProduction,
      sameSite: sessions.cookie?.sameSite ?? "lax",
      path: sessions.cookie?.path ?? "/",
      domain: sessions.cookie?.domain,
      overwrite: true,
    });
  }

  return access.token;
}

module.exports = {
  async sendOtp(ctx) {
    const { phone } = ctx.request.body?.data ?? ctx.request.body ?? {};

    const result = await strapi
      .service(OTP_UID)
      .requestOtp(phone, { ip: ctx.ip });

    if (!result.ok) {
      const isRateLimit =
        result.reason === "RATE_LIMITED" || result.reason === "RESEND_COOLDOWN";

      ctx.status = isRateLimit ? 429 : 400;

      if (result.retryAfterSeconds) {
        ctx.set("Retry-After", String(result.retryAfterSeconds));
      }

      ctx.body = {
        success: false,
        code: result.reason,
        message: MESSAGES[result.reason] ?? MESSAGES.INVALID_PHONE,
        retryAfterSeconds: result.retryAfterSeconds ?? null,
      };

      return;
    }

    try {
      await sendSMS(result.phone, `کد ورود شما به موپت: ${result.code}`);
    } catch (error) {
      // Log the failure, never the code.
      strapi.log.error(
        `[auth-otp] SMS delivery failed for ${result.phone}: ${error.message}`,
      );

      ctx.status = 502;
      ctx.body = {
        success: false,
        code: "SMS_FAILED",
        message: MESSAGES.SMS_FAILED,
      };

      return;
    }

    ctx.body = {
      success: true,
      message: "کد تایید ارسال شد",
      data: {
        phone: result.phone,
        expiresInSeconds: result.expiresInSeconds,
        resendAfterSeconds: result.resendAfterSeconds,
        // Tells the client whether a real SMS was sent; it never reveals
        // the code itself.
        deliveryChannel: isProviderConfigured() ? "sms" : "console",
      },
    };
  },

  async verifyOtp(ctx) {
    const { phone, code } = ctx.request.body?.data ?? ctx.request.body ?? {};

    const result = await strapi
      .service(OTP_UID)
      .verifyOtp(phone, code, { ip: ctx.ip });

    if (!result.ok) {
      ctx.status = result.reason === "OTP_TOO_MANY_ATTEMPTS" ? 429 : 400;

      ctx.body = {
        success: false,
        code: result.reason,
        message: MESSAGES[result.reason] ?? MESSAGES.OTP_INVALID,
        remainingAttempts: result.remainingAttempts ?? null,
      };

      return;
    }

    const user = await findOrCreateUser(strapi, result.phone);

    if (user.blocked) {
      ctx.status = 403;
      ctx.body = {
        success: false,
        code: "USER_BLOCKED",
        message: "حساب کاربری شما غیرفعال است.",
      };

      return;
    }

    const customer = await findOrCreateCustomer(strapi, user, result.phone);

    const token = await issueToken(strapi, ctx, user);

    ctx.body = {
      success: true,
      data: {
        token,
        user: sanitizeUser(user),
        customer: sanitizeCustomer(customer),
      },
    };
  },

  /** Session bootstrap for the frontend: who am I? */
  async me(ctx) {
    const user = ctx.state.user;

    if (!user) return ctx.unauthorized("ابتدا وارد شوید");

    const customer = await strapi.documents(CUSTOMER_UID).findFirst({
      filters: { users_permissions_user: { id: user.id } },
    });

    ctx.body = {
      success: true,
      data: {
        user: sanitizeUser(user),
        customer: sanitizeCustomer(customer),
      },
    };
  },

  /**
   * Clears the refresh cookie when the project runs in refresh-token
   * mode. Stateless JWTs are simply dropped by the client.
   */
  async logout(ctx) {
    const sessions = strapi.config.get("plugin::users-permissions.sessions");
    const cookieName = sessions?.cookie?.name || "strapi_up_refresh";

    ctx.cookies.set(cookieName, null, {
      path: sessions?.cookie?.path ?? "/",
      domain: sessions?.cookie?.domain,
      overwrite: true,
    });

    ctx.body = { success: true };
  },
};

module.exports.__internal = { sanitizeUser, sanitizeCustomer, normalizePhone };
