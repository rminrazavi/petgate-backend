"use strict";

module.exports = {
  beforeCreate(event) {
    const { data } = event.params;

    const stock = data.stock ?? 0;
    const reserved = data.reserved ?? 0;
    const sold = data.sold ?? 0;
    const stockExpired = data.stockExpired ?? 0;

    if (stock < 0) {
      throw new Error("Stock cannot be negative");
    }

    if (reserved < 0) {
      throw new Error("Reserved stock cannot be negative");
    }

    if (sold < 0) {
      throw new Error("Sold cannot be negative");
    }

    if (stockExpired < 0) {
      throw new Error("Expired stock cannot be negative");
    }

    if (reserved > stock) {
      throw new Error("Reserved stock cannot exceed stock");
    }
  },

  beforeUpdate(event) {
    const { data } = event.params;

    if (data.stock !== undefined && data.stock < 0) {
      throw new Error("Stock cannot be negative");
    }

    if (data.reserved !== undefined && data.reserved < 0) {
      throw new Error("Reserved stock cannot be negative");
    }

    if (data.sold !== undefined && data.sold < 0) {
      throw new Error("Sold cannot be negative");
    }

    if (data.stockExpired !== undefined && data.stockExpired < 0) {
      throw new Error("Expired stock cannot be negative");
    }

    if (
      data.stock !== undefined &&
      data.reserved !== undefined &&
      data.reserved > data.stock
    ) {
      throw new Error("Reserved stock cannot exceed stock");
    }
  },
};
