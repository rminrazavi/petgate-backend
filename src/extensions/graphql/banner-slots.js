"use strict";

/**
 * Campaign banner slots for the storefront.
 *
 * NO NEW CMS MODEL. This is a read API over the EXISTING
 * `api::banner.banner` content type (src/api/banner/content-types/banner),
 * which already owns every field the approved wireframe's campaign slots
 * need: position, active, startDate/endDate, priority, order, desktopImage,
 * mobileImage, alt text (on the media), title/subtitle and an optional CTA
 * (buttonText/buttonLink or link).
 *
 * WHY A RESOLVER INSTEAD OF QUERYING `banners` FROM THE FRONTEND
 * -------------------------------------------------------------
 * The "is this banner live right now" rule is three conditions (active, the
 * start bound, the end bound) where BOTH date bounds are optional, plus a
 * two-key ordering. Expressed as client-side filters it would be duplicated
 * in every page that renders a slot, and — worse — `now` would end up inside
 * the GraphQL query string, so every request would be a cache miss and an
 * expired banner could still be served from a warm cache.
 *
 * Resolving it server-side means: one contract, one place that decides what
 * "live" means, a stable query document (cacheable), and `now` evaluated per
 * request. An empty slot returns an empty list, which the UI renders as
 * nothing at all.
 */

const BANNER_UID = "api::banner.banner";

/** Mirrors the `position` enumeration in banner/schema.json exactly. */
const BANNER_POSITIONS = [
  "home_top",
  "home_middle",
  "category",
  "product",
  "sidebar",
];

const DEFAULT_LIMIT_PER_POSITION = 3;
const MAX_LIMIT_PER_POSITION = 6;

/** Highest priority first, then the editor's explicit `order`, then stable. */
function compareBanners(a, b) {
  return (
    (b.priority ?? 0) - (a.priority ?? 0) ||
    (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
    String(a.documentId ?? "").localeCompare(String(b.documentId ?? ""))
  );
}

/**
 * A banner is live when it is active AND inside its date window. A missing
 * bound means "unbounded on that side", which is why this cannot be a plain
 * `$lte`/`$gte` pair.
 */
function buildLiveFilters(positions, now) {
  return {
    active: { $eq: true },
    position: { $in: positions },
    $and: [
      { $or: [{ startDate: { $null: true } }, { startDate: { $lte: now } }] },
      { $or: [{ endDate: { $null: true } }, { endDate: { $gte: now } }] },
    ],
  };
}

/** True when the CMS has at least one usable crop for this banner. */
function hasArtwork(banner) {
  return Boolean(banner?.desktopImage?.url || banner?.mobileImage?.url);
}

/**
 * A banner has to have SOMETHING to render, or it is a broken box.
 *
 * Artwork is the normal case and stays fully supported (both crops, real
 * intrinsic dimensions, Strapi's generated formats). It is not REQUIRED, though:
 * a campaign whose artwork has not been uploaded yet but which does have a
 * headline is still a real campaign, and the storefront renders it
 * typographically at the same fixed aspect ratio — so it costs no layout shift
 * and upgrades to the image the moment a crop is published. A row with neither
 * artwork nor a title has nothing to say and is dropped.
 */
function isRenderable(banner) {
  return hasArtwork(banner) || Boolean(banner?.title?.trim());
}

function toCta(banner) {
  const href = banner.buttonLink?.trim() || banner.link?.trim() || null;

  if (!href) return null;

  return {
    label: banner.buttonText?.trim() || banner.title?.trim() || "مشاهده",
    href,
  };
}

function clampLimit(value) {
  const parsed = Number.isInteger(value) ? value : DEFAULT_LIMIT_PER_POSITION;

  return Math.min(MAX_LIMIT_PER_POSITION, Math.max(1, parsed));
}

module.exports = ({ nexus, strapi }) => ({
  types: [
    nexus.enumType({
      name: "BannerPosition",
      members: BANNER_POSITIONS,
    }),

    nexus.objectType({
      name: "BannerCta",
      definition(t) {
        t.nonNull.string("label");
        t.nonNull.string("href");
      },
    }),

    nexus.objectType({
      name: "BannerSlotItem",
      definition(t) {
        t.nonNull.string("documentId");
        t.string("title");
        t.string("subtitle");
        t.string("description");
        t.string("badge");
        t.nonNull.field("position", { type: "BannerPosition" });
        t.field("desktopImage", { type: "UploadFile" });
        t.field("mobileImage", { type: "UploadFile" });
        t.field("cta", { type: "BannerCta" });
      },
    }),

    nexus.objectType({
      name: "BannerSlot",
      definition(t) {
        t.nonNull.field("position", { type: "BannerPosition" });
        t.nonNull.list.nonNull.field("banners", { type: "BannerSlotItem" });
      },
    }),

    nexus.extendType({
      type: "Query",
      definition(t) {
        t.nonNull.list.nonNull.field("bannerSlots", {
          type: "BannerSlot",
          args: {
            positions: nexus.nonNull(
              nexus.list(nexus.nonNull(nexus.arg({ type: "BannerPosition" }))),
            ),
            limitPerPosition: nexus.intArg({
              default: DEFAULT_LIMIT_PER_POSITION,
            }),
          },
          resolve: async (_parent, args) => {
            const positions = [...new Set(args.positions ?? [])].filter(
              (position) => BANNER_POSITIONS.includes(position),
            );

            if (positions.length === 0) return [];

            const limit = clampLimit(args.limitPerPosition);
            const now = new Date().toISOString();

            try {
              const banners = await strapi.documents(BANNER_UID).findMany({
                filters: buildLiveFilters(positions, now),
                populate: { desktopImage: true, mobileImage: true },
                /* `priority`/`order` are real Banner columns, so this IS a
                   DB-level sort. Re-sorted in memory too, because the
                   null-handling of the secondary key has to be explicit. */
                sort: ["priority:desc", "order:asc"],
                limit: limit * positions.length,
              });

              const grouped = new Map(
                positions.map((position) => [position, []]),
              );

              for (const banner of banners) {
                if (!isRenderable(banner)) continue;

                grouped.get(banner.position)?.push({
                  documentId: banner.documentId,
                  title: banner.title ?? null,
                  subtitle: banner.subtitle ?? null,
                  description: banner.description ?? null,
                  badge: banner.badge ?? null,
                  position: banner.position,
                  desktopImage: banner.desktopImage ?? null,
                  mobileImage: banner.mobileImage ?? null,
                  cta: toCta(banner),
                });
              }

              return positions.map((position) => ({
                position,
                banners: (grouped.get(position) ?? [])
                  .sort(compareBanners)
                  .slice(0, limit),
              }));
            } catch (error) {
              strapi.log.error(
                `[MOPET bannerSlots] failed ${JSON.stringify({
                  positions,
                  message: error.message,
                })}`,
              );

              /* A campaign slot is decoration. A CMS hiccup must not take
                 the homepage down with it — the slot renders nothing. */
              return positions.map((position) => ({ position, banners: [] }));
            }
          },
        });
      },
    }),
  ],

  resolversConfig: {
    "Query.bannerSlots": { auth: false },
  },
});

module.exports.BANNER_POSITIONS = BANNER_POSITIONS;
module.exports.buildLiveFilters = buildLiveFilters;
module.exports.compareBanners = compareBanners;
module.exports.hasArtwork = hasArtwork;
module.exports.isRenderable = isRenderable;
module.exports.toCta = toCta;
module.exports.clampLimit = clampLimit;
