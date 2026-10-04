"use strict";

function validateWindow(data, current = {}) {
  const start = data.startDate ?? current.startDate;
  const end = data.endDate ?? current.endDate;
  if (start && end && new Date(end) <= new Date(start)) {
    throw new Error("Banner endDate must be later than startDate");
  }
}

module.exports = {
  beforeCreate(event) {
    validateWindow(event.params.data);
  },
  async beforeUpdate(event) {
    const current = await strapi.db.query("api::banner.banner").findOne({
      where: event.params.where,
      select: ["startDate", "endDate"],
    });
    validateWindow(event.params.data, current ?? {});
  },
};
