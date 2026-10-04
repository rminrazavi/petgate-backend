"use strict";

/**
 * The two homepage campaigns MOPET ships with: «پروفایل پت» and
 * «خرید وزن دلخواه».
 *
 * WHY THIS IS A SEED AND NOT A COMPONENT
 * --------------------------------------
 * Both are campaigns, and MOPET already models a campaign: `api::banner.banner`
 * owns position, active, the start/end window, priority, order, both image crops
 * and a CTA (see extensions/graphql/banner-slots.js). Hardcoding either of them
 * into a React component would be a second banner architecture — a campaign
 * marketing could not schedule, reword, reorder, re-target or switch off without
 * a deploy. So they are created as CMS ROWS, once, and are ordinary editable
 * banners from that moment on.
 *
 * IDEMPOTENT, AND IT NEVER OVERWRITES AN EDITOR
 * ---------------------------------------------
 * Each definition is keyed by its `buttonLink`, which is its stable identity.
 * If a banner with that key already exists this does nothing at all — it does
 * not re-publish it, does not restore copy an editor changed, and does not
 * reactivate one they switched off. Deleting the row is therefore permanent, as
 * an editor would expect.
 *
 * NO ARTWORK IS INVENTED. Neither seed carries an image: campaign artwork is a
 * design deliverable, not something a bootstrap can conjure. `banner-slots.js`
 * treats artwork as optional-but-supported, so these render typographically at
 * the same fixed aspect ratio until a crop is uploaded in the admin, then
 * upgrade to the responsive desktop/mobile `<picture>` automatically.
 */

const BANNER_UID = "api::banner.banner";

/**
 * Funnel placement, deliberate rather than incidental:
 *  - the pet profile ask sits in `home_top`, before the customer commits to a
 *    category, because everything below it gets better once we know the pet;
 *  - custom weight sits in `home_middle`, after the catalogue and the bundles,
 *    where a customer who has browsed and not decided is most open to "buy
 *    exactly the amount you need".
 */
const CAMPAIGN_BANNERS = [
  {
    key: "/pets/new",
    data: {
      title: "پروفایل پتت رو کامل کن",
      subtitle:
        "سن، وزن و شرایط پتت رو که بدونیم، پیشنهادها دقیقاً مناسب خودش می‌شه",
      description:
        "با یک پروفایل کوتاه، غذای مناسب سن و شرایط حیوانت را سریع‌تر پیدا می‌کنی و مقدار مصرف ماهانه‌اش هم برایت حساب می‌شود.",
      badge: "پروفایل پت",
      buttonText: "ساخت پروفایل پت",
      buttonLink: "/pets/new",
      link: "/pets/new",
      position: "home_top",
      priority: 20,
      order: 1,
      active: true,
    },
  },
  {
    key: "/custom-weight",
    data: {
      title: "غذای موردنظرت رو به وزن دلخواه بخر",
      subtitle: "از ۲۵۰ گرم تا ۱۰ کیلوگرم، هر مقداری که لازم داری",
      description:
        "لازم نیست کیسه بزرگ بخری تا یک غذا را امتحان کنی. وزن دلخواهت را انتخاب کن و همان مقدار را بگیر.",
      badge: "وزن دلخواه",
      buttonText: "خرید وزن دلخواه",
      buttonLink: "/custom-weight",
      link: "/custom-weight",
      position: "home_middle",
      priority: 20,
      order: 1,
      active: true,
    },
  },
];

async function ensureCampaignBanners(strapi) {
  for (const campaign of CAMPAIGN_BANNERS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const existing = await strapi.documents(BANNER_UID).findFirst({
        filters: { buttonLink: { $eq: campaign.key } },
        fields: ["documentId"],
      });

      if (existing) continue;

      // eslint-disable-next-line no-await-in-loop
      await strapi.documents(BANNER_UID).create({ data: campaign.data });

      strapi.log.info(
        `[bootstrap] Created campaign banner "${campaign.data.title}" in ${campaign.data.position}`,
      );
    } catch (error) {
      /* Logged loudly and skipped, never swallowed: a campaign row failing to
         seed must not stop the application from booting, but it also must not
         disappear quietly. */
      strapi.log.error(
        `[bootstrap] Failed to ensure campaign banner ${campaign.key}: ${error.message}`,
      );
    }
  }
}

module.exports = { ensureCampaignBanners, CAMPAIGN_BANNERS };
