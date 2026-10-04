"use strict";

const { createCoreService } = require("@strapi/strapi").factories;
const PET_UID = "api::pet.pet";
const CATEGORY_UID = "api::category.category";
const GENDERS = ["male", "female", "other"];
const ACTIVITIES = ["low", "moderate", "high"];
const WRITABLE_FIELDS = ["name", "breed", "gender", "birthDate", "weight", "color", "microchipNumber", "activityLevel", "medicalHistory", "nutrition", "care"];
const POPULATE = { category: { fields: ["name", "slug"] }, image: true, medicalHistory: true, nutrition: { populate: ["foodAllergies", "forbiddenFoods"] }, care: true };

function toPet(pet) {
  if (!pet) return null;
  return {
    documentId: pet.documentId, name: pet.name, breed: pet.breed ?? null,
    gender: pet.gender ?? null, birthDate: pet.birthDate ?? null,
    weight: pet.weight == null ? null : Number(pet.weight), color: pet.color ?? null,
    microchipNumber: pet.microchipNumber ?? null, activityLevel: pet.activityLevel ?? null,
    medicalHistory: pet.medicalHistory ?? [], nutrition: pet.nutrition ?? null,
    care: pet.care ?? null,
    category: pet.category ? { documentId: pet.category.documentId, name: pet.category.name, slug: pet.category.slug ?? null } : null,
    image: pet.image ? { url: pet.image.url, alternativeText: pet.image.alternativeText ?? null, width: pet.image.width ?? null, height: pet.image.height ?? null } : null,
    createdAt: pet.createdAt ?? null, updatedAt: pet.updatedAt ?? null,
  };
}

function dateOrNull(value, label) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} معتبر نیست`);
  return String(value).slice(0, 10);
}

function cleanNamedItems(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({ name: String(item?.name ?? "").trim() })).filter((item) => item.name).slice(0, 50);
}

async function buildData(strapi, input = {}, { partial = false } = {}) {
  const data = {};
  for (const field of WRITABLE_FIELDS) if (input[field] !== undefined) data[field] = input[field];

  if (!partial || data.name !== undefined) {
    const name = typeof data.name === "string" ? data.name.trim() : "";
    if (!name) throw new Error("نام پت الزامی است");
    if (name.length > 60) throw new Error("نام پت حداکثر ۶۰ کاراکتر است");
    data.name = name;
  }
  if (data.gender != null && !GENDERS.includes(data.gender)) throw new Error("جنسیت معتبر نیست");
  if (data.activityLevel != null && !ACTIVITIES.includes(data.activityLevel)) throw new Error("سطح فعالیت معتبر نیست");
  if (data.weight != null) {
    const weight = Number(data.weight);
    if (!Number.isFinite(weight) || weight <= 0 || weight > 200) throw new Error("وزن باید بین ۰ و ۲۰۰ باشد");
    data.weight = weight;
  }
  if (data.birthDate !== undefined) {
    data.birthDate = dateOrNull(data.birthDate, "تاریخ تولد");
    if (data.birthDate && new Date(data.birthDate).getTime() > Date.now()) throw new Error("تاریخ تولد نمی‌تواند در آینده باشد");
  }
  if (data.medicalHistory !== undefined) {
    data.medicalHistory = (Array.isArray(data.medicalHistory) ? data.medicalHistory : []).map((entry) => ({
      disease: String(entry?.disease ?? "").trim(), startDate: dateOrNull(entry?.startDate, "تاریخ بیماری"),
      endDate: dateOrNull(entry?.endDate, "تاریخ بیماری"), status: entry?.status ?? null,
      description: String(entry?.description ?? "").trim() || null,
    })).filter((entry) => entry.disease).slice(0, 50);
  }
  if (data.nutrition !== undefined && data.nutrition) data.nutrition = { ...data.nutrition, foodAllergies: cleanNamedItems(data.nutrition.foodAllergies), forbiddenFoods: cleanNamedItems(data.nutrition.forbiddenFoods) };
  if (data.care !== undefined && data.care) data.care = { ...data.care, lastVaccination: dateOrNull(data.care.lastVaccination, "تاریخ واکسیناسیون"), lastDeworming: dateOrNull(data.care.lastDeworming, "تاریخ ضدانگل"), lastVetVisit: dateOrNull(data.care.lastVetVisit, "تاریخ دامپزشک"), lastGrooming: dateOrNull(data.care.lastGrooming, "تاریخ گرومینگ") };

  if (input.categoryId !== undefined) {
    if (!input.categoryId) data.category = null;
    else {
      const category = await strapi.documents(CATEGORY_UID).findOne({ documentId: input.categoryId, fields: ["name"], populate: { parents: { fields: ["name"] } } });
      if (!category || (category.parents ?? []).length > 0) throw new Error("نوع حیوان معتبر نیست");
      data.category = category.documentId;
    }
  }
  return data;
}

module.exports = createCoreService(PET_UID, ({ strapi }) => ({
  toPet,
  async list(customerId) { const pets = await strapi.documents(PET_UID).findMany({ filters: { customer: { documentId: customerId } }, populate: POPULATE, sort: "createdAt:asc" }); return pets.map(toPet); },
  async findOwned(customerId, documentId) { return strapi.documents(PET_UID).findFirst({ filters: { documentId: { $eq: documentId }, customer: { documentId: customerId } }, populate: POPULATE }); },
  async createForCustomer(customerId, input) { const data = await buildData(strapi, input); return toPet(await strapi.documents(PET_UID).create({ data: { ...data, customer: customerId }, populate: POPULATE })); },
  async updateOwned(customerId, documentId, input) { const existing = await this.findOwned(customerId, documentId); if (!existing) return null; const data = await buildData(strapi, input, { partial: true }); return toPet(await strapi.documents(PET_UID).update({ documentId, data, populate: POPULATE })); },
  async deleteOwned(customerId, documentId) { const existing = await this.findOwned(customerId, documentId); if (!existing) return false; await strapi.documents(PET_UID).delete({ documentId }); return true; },
}));

module.exports.buildData = buildData;
module.exports.toPet = toPet;
module.exports.WRITABLE_FIELDS = WRITABLE_FIELDS;
