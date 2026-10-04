"use strict";

/**
 * customer controller
 */

const { createCoreController } = require("@strapi/strapi").factories;

const { resolveCurrentCustomer } = require("../../../utils/current-customer");

const CUSTOMER_UID = "api::customer.customer";

/**
 * Fields a customer may edit about themselves.
 *
 * Everything else on the Customer content-type is either derived by the
 * purchase flow (points, wallet, totalSpent, orderCount, vipLevel),
 * identity-bound (phone, which is the OTP login key and can only change
 * through the OTP flow), or a relation. Whitelisting - rather than
 * blacklisting - means a future schema field cannot silently become
 * customer-writable.
 *
 * nationalCode is intentionally NOT writable or returned here: it is
 * sensitive identity data with no use anywhere in the storefront.
 */
const EDITABLE_FIELDS = ["firstName", "lastName", "birthDate", "gender"];

const GENDERS = ["male", "female", "other"];

const MAX_NAME_LENGTH = 60;

/** Mirrors sanitizeCustomer() in api::auth-otp so both contracts match. */
function sanitizeProfile(customer) {
  if (!customer) return null;

  return {
    documentId: customer.documentId,
    firstName: customer.firstName ?? null,
    lastName: customer.lastName ?? null,
    phone: customer.phone ?? null,
    birthDate: customer.birthDate ?? null,
    gender: customer.gender ?? null,
    points: customer.points ?? 0,
    vipLevel: customer.vipLevel ?? null,
  };
}

function buildProfileData(input) {
  const data = {};

  for (const field of EDITABLE_FIELDS) {
    if (input[field] !== undefined) data[field] = input[field];
  }

  for (const field of ["firstName", "lastName"]) {
    if (data[field] === undefined) continue;

    const value = data[field] === null ? "" : String(data[field]).trim();

    if (value.length > MAX_NAME_LENGTH) {
      throw new Error(`طول ${field} بیش از حد مجاز است`);
    }

    data[field] = value || null;
  }

  if (data.gender != null && data.gender !== "" && !GENDERS.includes(data.gender)) {
    throw new Error("جنسیت انتخاب‌شده معتبر نیست");
  }

  if (data.gender === "") data.gender = null;

  if (data.birthDate != null && data.birthDate !== "") {
    const birthDate = new Date(data.birthDate);

    if (Number.isNaN(birthDate.getTime())) {
      throw new Error("تاریخ تولد معتبر نیست");
    }

    if (birthDate.getTime() > Date.now()) {
      throw new Error("تاریخ تولد نمی‌تواند در آینده باشد");
    }
  } else if (data.birthDate === "") {
    data.birthDate = null;
  }

  if (Object.keys(data).length === 0) {
    throw new Error("هیچ فیلد قابل ویرایشی ارسال نشده");
  }

  return data;
}

module.exports = createCoreController(CUSTOMER_UID, ({ strapi }) => ({
  async me(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);

    if (!customer) return ctx.notFound("مشتری پیدا نشد");

    ctx.body = { success: true, data: sanitizeProfile(customer) };
  },

  async updateMe(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);

    if (!customer) return ctx.notFound("مشتری پیدا نشد");

    let data;

    try {
      data = buildProfileData(ctx.request.body?.data ?? ctx.request.body ?? {});
    } catch (error) {
      return ctx.badRequest(error.message);
    }

    const updated = await strapi.documents(CUSTOMER_UID).update({
      documentId: customer.documentId,
      data,
    });

    ctx.body = { success: true, data: sanitizeProfile(updated) };
  },
}));

module.exports.buildProfileData = buildProfileData;
module.exports.sanitizeProfile = sanitizeProfile;
module.exports.EDITABLE_FIELDS = EDITABLE_FIELDS;
