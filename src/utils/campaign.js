"use strict";

module.exports = {
  isActive(campaign) {
    const now = new Date();

    return (
      campaign.active === true &&
      new Date(campaign.startDate) <= now &&
      new Date(campaign.endDate) >= now
    );
  },

  applyDiscount(price, campaign) {
    if (!campaign) {
      return price;
    }

    if (campaign.discountType === "percent") {
      return Math.max(0, price - (price * campaign.discountValue) / 100);
    }

    if (campaign.discountType === "fixed") {
      return Math.max(0, price - campaign.discountValue);
    }

    return price;
  },
};
