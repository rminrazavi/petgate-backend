"use strict";

/**
 * Makes sure the footer's certification slots EXIST in the CMS: «اینماد» and
 * «نماد اعتماد دیجی‌پی».
 *
 * Same rule as the campaign banner seed: the storefront renders CMS rows, so the
 * rows have to exist for an editor to fill in. This creates the two slots on the
 * published Setting entry and never touches one that is already there — an
 * editor's copy, artwork, ordering or `active` flag is theirs.
 *
 * IT DOES NOT INVENT A CERTIFICATION. No artwork is generated and no
 * verification URL is guessed. e-Namad credentials are read from the environment
 * (MOPET_ENAMAD_ID / MOPET_ENAMAD_CODE) when a deployment supplies them, which is
 * how the real seal reaches production without anyone pasting HTML into a
 * template; otherwise the slot is created empty and the storefront renders it as
 * an accessible text credential until the real asset is uploaded in the admin.
 * That is the honest state — a fabricated seal is a legal problem, not a
 * placeholder.
 */

const SETTING_UID = "api::setting.setting";

function definitions() {
  return [
    {
      provider: "enamad",
      title: "نماد اعتماد الکترونیکی",
      enamadId: process.env.MOPET_ENAMAD_ID?.trim() || null,
      enamadCode: process.env.MOPET_ENAMAD_CODE?.trim() || null,
      order: 1,
      active: true,
    },
    {
      provider: "digipay",
      title: "نماد اعتماد دیجی‌پی",
      verificationUrl: process.env.MOPET_DIGIPAY_URL?.trim() || null,
      order: 2,
      active: true,
    },
  ];
}

async function ensureTrustSymbols(strapi) {
  try {
    const setting = await strapi.documents(SETTING_UID).findFirst({
      status: "published",
      fields: ["documentId"],
      populate: { trustSymbols: true },
    });

    if (!setting) {
      /* No Setting entry yet means the site has not been configured at all;
         creating one here would invent the whole site configuration. */
      strapi.log.warn(
        "[bootstrap] No published Setting entry, so footer trust symbols were not seeded.",
      );
      return;
    }

    const existing = new Set(
      (setting.trustSymbols ?? []).map((symbol) => symbol?.provider),
    );
    const missing = definitions().filter(
      (symbol) => !existing.has(symbol.provider),
    );

    if (missing.length === 0) return;

    await strapi.documents(SETTING_UID).update({
      documentId: setting.documentId,
      data: { trustSymbols: [...(setting.trustSymbols ?? []), ...missing] },
    });

    strapi.log.info(
      `[bootstrap] Added footer trust symbol slot(s): ${missing
        .map((symbol) => symbol.provider)
        .join(", ")}`,
    );
  } catch (error) {
    strapi.log.error(
      `[bootstrap] Failed to ensure footer trust symbols: ${error.message}`,
    );
  }
}

module.exports = { ensureTrustSymbols, definitions };
