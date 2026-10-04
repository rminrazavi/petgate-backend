"use strict";

/**
 * Footer trust badges, from the EXISTING `api::setting.setting` content type.
 *
 * NO NEW CMS MODEL and no invented certifications. `Setting.trustItems` is
 * already a repeatable `site.trust-item` component
 * (src/components/site/trust-item.json) with `title`, `description`, an `icon`
 * enumeration, an optional `url` and an `active` flag. That is the only place
 * MOPET models a trust symbol, so it is the only place the footer may read one
 * from.
 *
 * WHY A RESOLVER
 * --------------
 * `active` lives on the COMPONENT, not on the row, so it cannot be expressed as
 * a Strapi filter — an inactive badge would come back with the settings entry
 * and every consumer would have to remember to drop it. Filtering here means an
 * editor unticking `active` actually removes the badge everywhere, once.
 *
 * If there is no published Setting, or it has no active trust items, this
 * returns an empty list and the footer renders no badge strip at all. A trust
 * badge that is not backed by a real commitment is worse than no badge, so
 * there is deliberately no fallback list.
 */

const SETTING_UID = "api::setting.setting";

/** Mirrors the `icon` enumeration in components/site/trust-item.json. */
const TRUST_ICONS = ["shield", "truck", "payment", "support", "return"];

/* ---- certification seals (e-Namad, Digipay) ----------------------------- */

/**
 * TRUST SYMBOLS are a different thing from TRUST ITEMS and that is why they are
 * a different component, not a second copy of the same one.
 *
 * A trust ITEM is a service promise MOPET makes ("ضمانت اصالت کالا") and is
 * rendered as an icon plus text. A trust SYMBOL is a certification a THIRD PARTY
 * issued — the e-Namad seal, the Digipay trust badge — and it has properties a
 * promise does not: an issuer, real artwork owned by that issuer, and a
 * verification URL that has to stay pointed at the issuer to mean anything.
 *
 * NOTHING HERE IS DRAWN BY US. There is no fallback SVG and no stand-in image: a
 * counterfeit certification mark is a legal problem, not a design shortcut. The
 * seal renders when the CMS has the real thing, in the two forms the issuers
 * actually publish:
 *
 *   - e-Namad issues `id` + `Code`; the official seal is
 *     `https://trustseal.enamad.ir/logo.aspx?id=<id>&Code=<code>` and it must
 *     link to `https://trustseal.enamad.ir/?id=<id>&Code=<code>`. Those are
 *     DERIVED here from the two credentials so an editor pastes what e-Namad gave
 *     them and nothing else. Uploading the seal to Strapi instead is also
 *     supported and is what e-Namad's own guidance recommends for page speed —
 *     the local artwork replaces the image source, never the verification link.
 *   - Digipay (and anything else) supplies artwork; that upload plus its link is
 *     the whole contract.
 *
 * A symbol with neither artwork nor derivable artwork is still returned, with
 * `imageUrl: null`. The storefront renders it as an accessible text credential
 * rather than a broken image — an honest "we hold this" that upgrades to the real
 * seal the moment the asset lands, and never a fabricated logo.
 */
const TRUST_PROVIDERS = ["enamad", "digipay", "samandehi", "other"];

const ENAMAD_SEAL_BASE = "https://trustseal.enamad.ir";

function enamadUrls(symbol) {
  const id = symbol.enamadId?.trim();
  const code = symbol.enamadCode?.trim();

  if (!id || !code) return { imageUrl: null, verificationUrl: null };

  const query = `id=${encodeURIComponent(id)}&Code=${encodeURIComponent(code)}`;

  return {
    imageUrl: `${ENAMAD_SEAL_BASE}/logo.aspx?${query}`,
    verificationUrl: `${ENAMAD_SEAL_BASE}/?${query}`,
  };
}

function toTrustSymbol(symbol) {
  const title = symbol?.title?.trim();
  if (!title) return null;

  const provider = TRUST_PROVIDERS.includes(symbol.provider)
    ? symbol.provider
    : "other";

  const derived =
    provider === "enamad" ? enamadUrls(symbol) : { imageUrl: null, verificationUrl: null };

  /* Uploaded artwork wins over the issuer's remote image (faster, and it is
     what e-Namad recommends); the verification URL prefers the editor's
     explicit value and otherwise falls back to the derived official one. */
  const imageUrl = symbol.image?.url?.trim() || derived.imageUrl;
  const verificationUrl =
    symbol.verificationUrl?.trim() || derived.verificationUrl;

  return {
    provider,
    title,
    imageUrl: imageUrl || null,
    imageWidth: symbol.image?.width ?? null,
    imageHeight: symbol.image?.height ?? null,
    verificationUrl: verificationUrl || null,
    /* e-Namad's verifier looks for the Code on the <img> element itself. */
    verifierId: provider === "enamad" ? symbol.enamadCode?.trim() || null : null,
  };
}

/** Explicit `order` first, then stable. Same null-last rule as everywhere else. */
function compareTrustSymbols(a, b) {
  return (
    (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
  );
}

module.exports = ({ nexus, strapi }) => ({
  types: [
    nexus.enumType({
      name: "TrustBadgeIcon",
      members: TRUST_ICONS,
    }),

    nexus.enumType({
      name: "TrustSymbolProvider",
      members: TRUST_PROVIDERS,
    }),

    nexus.objectType({
      name: "TrustSymbol",
      definition(t) {
        t.nonNull.field("provider", { type: "TrustSymbolProvider" });
        t.nonNull.string("title");
        t.string("imageUrl");
        t.int("imageWidth");
        t.int("imageHeight");
        t.string("verificationUrl");
        t.string("verifierId");
      },
    }),

    nexus.objectType({
      name: "SiteSetting",
      definition(t) {
        t.string("phone");
        t.string("email");
        t.string("address");
        t.string("instagram");
        t.string("telegram");
        t.string("whatsapp");
      },
    }),

    nexus.objectType({
      name: "TrustBadge",

      definition(t) {
        t.nonNull.string("title");
        t.string("description");
        t.field("icon", { type: "TrustBadgeIcon" });
        t.string("url");
      },
    }),

    nexus.extendType({
      type: "Query",
      definition(t) {
        t.nonNull.list.nonNull.field("trustSymbols", {
          type: "TrustSymbol",
          resolve: async () => {
            try {
              const setting = await strapi.documents(SETTING_UID).findFirst({
                status: "published",
                fields: ["documentId"],
                populate: { trustSymbols: { populate: { image: true } } },
              });

              return (setting?.trustSymbols ?? [])
                .filter((symbol) => symbol?.active !== false)
                .slice()
                .sort(compareTrustSymbols)
                .map(toTrustSymbol)
                .filter(Boolean);
            } catch (error) {
              strapi.log.error(
                `[MOPET trustSymbols] failed ${JSON.stringify({
                  message: error.message,
                })}`,
              );

              /* Footer decoration path, same rule as trustBadges: a settings
                 read failing must not take every page's footer down. */
              return [];
            }
          },
        });

        t.field("siteSetting", {
          type: "SiteSetting",
          resolve: async () => {
            try {
              const setting = await strapi.documents(SETTING_UID).findFirst({
                status: "published",
                fields: ["phone", "email", "address", "instagram", "telegram", "whatsapp"],
              });
              if (!setting) return null;
              return {
                phone: setting.phone?.trim() || null,
                email: setting.email?.trim() || null,
                address: setting.address?.trim() || null,
                instagram: setting.instagram?.trim() || null,
                telegram: setting.telegram?.trim() || null,
                whatsapp: setting.whatsapp?.trim() || null,
              };
            } catch (error) {
              strapi.log.error(`[MOPET siteSetting] failed: ${error.message}`);
              return null;
            }
          },
        });

        t.nonNull.list.nonNull.field("trustBadges", {
          type: "TrustBadge",
          resolve: async () => {
            try {
              const setting = await strapi.documents(SETTING_UID).findFirst({
                status: "published",
                fields: ["documentId"],
                populate: { trustItems: true },
              });

              return (setting?.trustItems ?? [])
                .filter((item) => item?.active !== false && item?.title?.trim())
                .map((item) => ({
                  title: item.title.trim(),
                  description: item.description?.trim() || null,
                  icon: TRUST_ICONS.includes(item.icon) ? item.icon : null,
                  url: item.url?.trim() || null,
                }));
            } catch (error) {
              strapi.log.error(
                `[MOPET trustBadges] failed ${JSON.stringify({
                  message: error.message,
                })}`,
              );

              /* Footer decoration. A settings read failing must not take the
                 footer — or any page that renders it — down with it. */
              return [];
            }
          },
        });
      },
    }),
  ],

  resolversConfig: {
    "Query.trustBadges": { auth: false },
    "Query.trustSymbols": { auth: false },
    "Query.siteSetting": { auth: false },
  },
});

module.exports.TRUST_ICONS = TRUST_ICONS;
module.exports.TRUST_PROVIDERS = TRUST_PROVIDERS;
module.exports.enamadUrls = enamadUrls;
module.exports.toTrustSymbol = toTrustSymbol;
module.exports.compareTrustSymbols = compareTrustSymbols;
