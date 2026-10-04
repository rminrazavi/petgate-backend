"use strict";

const SETTING_UID = "api::setting.setting";
const TRUST_UID = "api::trust-promise.trust-promise";

function stableKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Non-destructive bridge from the existing Setting.trustItems component to
 * the reusable TrustPromise collection. It only migrates real CMS content,
 * creates by a stable key, and never updates an existing editor-owned row.
 */
async function migrateTrustPromises(strapi) {
  const setting = await strapi.documents(SETTING_UID).findFirst({
    status: "published",
    populate: { trustItems: true },
  });
  if (!setting?.trustItems?.length) return;

  for (const [index, item] of setting.trustItems.entries()) {
    const key = stableKey(item.title);
    if (!key) continue;

    // eslint-disable-next-line no-await-in-loop
    const existing = await strapi.documents(TRUST_UID).findFirst({
      filters: { key: { $eq: key } },
      fields: ["documentId"],
    });
    if (existing) continue;

    // eslint-disable-next-line no-await-in-loop
    await strapi.documents(TRUST_UID).create({
      data: {
        key,
        label: item.title,
        shortLabel: item.title,
        order: index,
        active: item.active !== false,
      },
      status: "published",
    });
  }
}

module.exports = { migrateTrustPromises, stableKey };
