"use strict";

/**
 * Persian-aware slug utilities — the ONE slug strategy for the whole
 * project (Product, Category, Brand, Campaign, ProductBundle).
 *
 * Strapi's built-in `uid` field type transliterates non-Latin text and
 * only accepts /^[A-Za-z0-9-_.~]*$/, so it can never hold Persian
 * characters. Public slugs here are plain `string` fields and this
 * module reproduces the useful part of `uid` behaviour (clean, unique,
 * hyphenated slugs) while keeping Persian script intact.
 *
 * Uniqueness is enforced in the database (`"unique": true` on every
 * slug attribute); this module's job is to pick a value that will pass
 * that constraint.
 */

const crypto = require("crypto");

// ي (Arabic Yeh, U+064A) -> ی (Persian Yeh, U+06CC)
const ARABIC_YEH_RE = /\u064A/g;
// ك (Arabic Kaf, U+0643) -> ک (Persian Kaf, U+06A9)
const ARABIC_KAF_RE = /\u0643/g;

const PERSIAN_YEH = "\u06CC";
const PERSIAN_KAF = "\u06A9";

// Regular spaces, tabs, newlines, the Persian "half-space" (ZWNJ,
// U+200C), and the LTR/RTL marks all collapse to a single "-".
const WHITESPACE_RE = /[\s\u200C\u200E\u200F]+/g;

// Characters allowed in the final slug:
//   a-z 0-9 -            Latin letters/digits and the separator
//   \u0600-\u06FF         Arabic/Persian block (letters + Persian digits)
//   \u0750-\u077F         Arabic Supplement
//   \uFB50-\uFDFF         Arabic Presentation Forms-A
//   \uFE70-\uFEFF         Arabic Presentation Forms-B
// Everything else (punctuation, symbols, emoji, control chars) is
// stripped.
const DISALLOWED_RE =
  /[^a-z0-9\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF-]/g;

const MULTI_DASH_RE = /-{2,}/g;
const EDGE_DASH_RE = /^-+|-+$/g;

// Slug columns are capped at 200 chars on Product; keep every entity
// well inside that so a long Persian title can never fail to insert.
const MAX_BASE_LENGTH = 160;

/**
 * Turns free text (a `name`/`title`) into a clean slug that keeps
 * Persian characters, e.g.
 *   "غذای خشک سگ مفید مدل SDFA" -> "غذای-خشک-سگ-مفید-مدل-sdfa"
 */
function persianSlugify(input) {
  if (input === null || input === undefined) return "";

  return String(input)
    .trim()
    .replace(ARABIC_YEH_RE, PERSIAN_YEH)
    .replace(ARABIC_KAF_RE, PERSIAN_KAF)
    .toLowerCase() // only affects A-Z; Persian script has no case
    .replace(WHITESPACE_RE, "-")
    .replace(DISALLOWED_RE, "")
    .replace(MULTI_DASH_RE, "-")
    .replace(EDGE_DASH_RE, "")
    .slice(0, MAX_BASE_LENGTH)
    .replace(EDGE_DASH_RE, "");
}

/**
 * Finds a slug that isn't taken yet, appending "-2", "-3", ... as
 * needed (mirrors Strapi's own `uid` suffixing). Excludes the document
 * currently being updated.
 *
 * Uses the query engine (not the Document Service) so BOTH the draft
 * and published rows of every document are considered — a slug clash
 * against a draft row would still violate the DB unique constraint.
 */
async function getUniqueSlug(
  strapi,
  baseSlug,
  { documentId, uid = "api::product.product" } = {},
) {
  if (!baseSlug) return baseSlug;

  const existing = await strapi.db.query(uid).findMany({
    where: {
      slug: { $startsWith: baseSlug },
      ...(documentId ? { documentId: { $ne: documentId } } : {}),
    },
    select: ["slug"],
  });

  const taken = new Set(existing.map((entry) => entry.slug));

  if (!taken.has(baseSlug)) return baseSlug;

  let suffix = 2;
  while (taken.has(`${baseSlug}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseSlug}-${suffix}`;
}

/**
 * Single entry point used by every lifecycle.
 *
 * @param {object} strapi
 * @param {object} options
 * @param {string} options.uid              content-type UID
 * @param {string} options.source           raw text (name/title/slug)
 * @param {string} [options.documentId]     document being updated
 * @param {string} [options.fallbackPrefix] used when `source` sanitizes
 *   to an empty string (a name made only of punctuation/emoji, or an
 *   entity that genuinely has no usable title yet). Never returns "".
 */
async function buildUniqueSlug(
  strapi,
  { uid, source, documentId, fallbackPrefix = "mopet" },
) {
  if (!uid) throw new Error("buildUniqueSlug: `uid` is required.");

  let base = persianSlugify(source);

  if (!base) {
    // Random (not sequential, never a database id) so an unusable title
    // still produces a stable, non-guessable public URL.
    base = `${fallbackPrefix}-${crypto.randomBytes(4).toString("hex")}`;
  }

  return getUniqueSlug(strapi, base, { documentId, uid });
}

module.exports = { persianSlugify, getUniqueSlug, buildUniqueSlug };
