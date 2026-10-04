"use strict";

const UID = "api::coupon.coupon";

function validate(data, current = {}) {
  const type = data.type ?? current.type ?? "percent";
  const value = Number(data.value ?? current.value);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Coupon value must be greater than zero");
  }
  if (type === "percent" && value > 100) {
    throw new Error("Percentage coupon value cannot exceed 100");
  }
  if (typeof data.code === "string") data.code = data.code.trim().toUpperCase();
}

module.exports = {
  beforeCreate(event) {
    validate(event.params.data);
  },
  async beforeUpdate(event) {
    const current = await strapi.db.query(UID).findOne({
      where: event.params.where,
      select: ["type", "value"],
    });
    if (!current) throw new Error("Coupon not found");
    validate(event.params.data, current);
  },
};
