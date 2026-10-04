"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

const { resolveCurrentCustomer } = require("../../../utils/current-customer");

const PET_UID = "api::pet.pet";

/**
 * Pet HTTP layer.
 *
 * Ownership is derived from the JWT for every action, so a customer can
 * never read or mutate another customer's pet. Same shape as
 * api::wishlist's controller: `{ success, data }`, Persian error messages,
 * and validation errors mapped to 400 rather than leaking a stack trace.
 */

function readBody(ctx) {
  return ctx.request.body?.data ?? ctx.request.body ?? {};
}

module.exports = createCoreController(PET_UID, ({ strapi }) => ({
  async mine(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);

    if (!customer) return ctx.notFound("مشتری پیدا نشد");

    ctx.body = {
      success: true,
      data: await strapi.service(PET_UID).list(customer.documentId),
    };
  },

  async createMine(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);

    if (!customer) return ctx.notFound("مشتری پیدا نشد");

    try {
      ctx.body = {
        success: true,
        data: await strapi
          .service(PET_UID)
          .createForCustomer(customer.documentId, readBody(ctx)),
      };
    } catch (error) {
      return ctx.badRequest(error.message);
    }
  },

  async updateMine(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);

    if (!customer) return ctx.notFound("مشتری پیدا نشد");

    try {
      const pet = await strapi
        .service(PET_UID)
        .updateOwned(customer.documentId, ctx.params.documentId, readBody(ctx));

      // Not found and not-yours are the same response on purpose: it must
      // not be possible to probe for other customers' pet ids.
      if (!pet) return ctx.notFound("پت پیدا نشد");

      ctx.body = { success: true, data: pet };
    } catch (error) {
      return ctx.badRequest(error.message);
    }
  },

  async uploadPhoto(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);
    if (!customer) return ctx.unauthorized("ابتدا وارد شوید");

    const pet = await strapi.service(PET_UID).findOwned(customer.documentId, ctx.params.documentId);
    if (!pet) return ctx.notFound("پت پیدا نشد");

    const file = ctx.request.files?.file;
    if (!file) return ctx.badRequest("فایل عکس الزامی است");
    const mime = Array.isArray(file) ? file[0]?.mimetype : file.mimetype;
    if (!String(mime ?? "").startsWith("image/")) return ctx.badRequest("فقط فایل تصویری مجاز است");

    const files = Array.isArray(file) ? file : [file];
    const uploaded = await strapi.plugin("upload").service("upload").upload({
      data: { ref: PET_UID, refId: pet.id, field: "image" },
      files,
    });
    const media = uploaded?.[0];
    if (!media) return ctx.badRequest("آپلود عکس ناموفق بود");

    if (pet.image?.id && pet.image.id !== media.id) {
      await strapi.plugin("upload").service("upload").remove(pet.image);
    }
    const updated = await strapi.documents(PET_UID).update({ documentId: pet.documentId, data: { image: media.id }, populate: { category: true, image: true, medicalHistory: true, nutrition: { populate: ["foodAllergies", "forbiddenFoods"] }, care: true } });
    ctx.body = { success: true, data: strapi.service(PET_UID).toPet(updated) };
  },

  async removePhoto(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);
    if (!customer) return ctx.unauthorized("ابتدا وارد شوید");
    const pet = await strapi.service(PET_UID).findOwned(customer.documentId, ctx.params.documentId);
    if (!pet) return ctx.notFound("پت پیدا نشد");
    const image = pet.image;
    await strapi.documents(PET_UID).update({ documentId: pet.documentId, data: { image: null } });
    if (image?.id) await strapi.plugin("upload").service("upload").remove(image);
    ctx.body = { success: true, data: strapi.service(PET_UID).toPet({ ...pet, image: null }) };
  },

  async deleteMine(ctx) {
    const customer = await resolveCurrentCustomer(strapi, ctx);

    if (!customer) return ctx.notFound("مشتری پیدا نشد");

    const deleted = await strapi
      .service(PET_UID)
      .deleteOwned(customer.documentId, ctx.params.documentId);

    if (!deleted) return ctx.notFound("پت پیدا نشد");

    ctx.body = { success: true, data: { documentId: ctx.params.documentId } };
  },
}));
