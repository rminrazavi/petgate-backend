"use strict";

/**
 * ProductVariant attribute reading — the ONE place that knows which
 * attribute name means "weight" and which means "flavour".
 *
 * ROOT CAUSE THIS FIXES
 * ---------------------
 * `computeProductPricing` derived a variant's card label from
 * `attributes.find(a => a.name === "weight")`, i.e. from the LATIN
 * attribute name only. MOPET's catalogue is Persian and editors name the
 * attribute وزن (and طعم / مزه for flavour), so `weight` and `flavor`
 * came back undefined for real data. Downstream, the storefront's
 * `variantLabel()` fell through to the SKU — and to nothing at all for a
 * variant with no SKU, which is one of the two reasons the VariantPicker
 * rendered no chips.
 *
 * Aliases are matched on the CANONICAL form of the name (trimmed,
 * lower-cased, Arabic Yeh/Kaf normalised to Persian, ZWNJ and spaces
 * collapsed) so "وزن ", "وزن" with a half-space, and "Weight" are all
 * the same key. The attribute component itself is untouched: this is a
 * read rule, not a schema change, so no existing content has to be
 * re-entered.
 */

const ZWNJ_RE = /[\s\u200C\u200E\u200F_-]+/g;

function canonicalAttributeName(name) {
  if (typeof name !== "string") return "";

  return name
    .trim()
    .replace(/[\u064A\u0649]/g, "\u06CC")
    .replace(/\u0643/g, "\u06A9")
    .toLowerCase()
    .replace(ZWNJ_RE, "");
}

/**
 * Canonical attribute name -> the aliases that mean it.
 *
 * Persian first, because Persian is what the catalogue contains.
 */
const ATTRIBUTE_ALIASES = {
  weight: ["وزن", "وزنبسته", "اندازه", "سایز", "حجم", "weight", "size", "volume"],
  flavor: ["طعم", "مزه", "طعمدهنده", "flavor", "flavour", "taste"],
};

/** alias (canonical form) -> logical key. Built once. */
const ALIAS_INDEX = new Map();

for (const [key, aliases] of Object.entries(ATTRIBUTE_ALIASES)) {
  ALIAS_INDEX.set(key, key);
  for (const alias of aliases) {
    ALIAS_INDEX.set(canonicalAttributeName(alias), key);
  }
}

/**
 * Normalises a variant's raw `attributes` component list.
 *
 * Drops rows the component cannot render (a missing name or value) and
 * trims the rest. NOTE what this deliberately does NOT do: it does not
 * invent a name or a value for a half-filled attribute. An attribute
 * whose value is blank is bad data and is dropped, so the GraphQL
 * contract's `[ProductVariantAttribute!]!` stays honest without the
 * schema being weakened to nullable.
 */
function normalizeAttributes(attributes) {
  if (!Array.isArray(attributes)) return [];

  return attributes
    .filter(
      (attribute) =>
        attribute &&
        typeof attribute.name === "string" &&
        typeof attribute.value === "string" &&
        attribute.name.trim() !== "" &&
        attribute.value.trim() !== "",
    )
    .map((attribute) => ({
      name: attribute.name.trim(),
      value: attribute.value.trim(),
    }));
}

/**
 * Reads one logical attribute ("weight" | "flavor") out of a normalised
 * attribute list, matching Persian and Latin names alike.
 *
 * Returns undefined (not null, not "") when the variant genuinely has no
 * such attribute, so a caller can distinguish "absent" from "blank".
 */
function readAttribute(attributes, key) {
  for (const attribute of attributes || []) {
    if (ALIAS_INDEX.get(canonicalAttributeName(attribute.name)) === key) {
      const value = String(attribute.value ?? "").trim();
      if (value) return value;
    }
  }

  return undefined;
}

/**
 * The label a chip shows for a variant, decided ONCE on the backend so
 * the product page, the cards and the rails cannot disagree.
 *
 * Order: weight, then flavour, then the first attribute the variant
 * actually has, then the SKU. A variant with none of those has no label
 * and the storefront drops it — which is correct, because a chip with no
 * text is not selectable by anyone.
 */
function variantLabel(attributes, sku) {
  const weight = readAttribute(attributes, "weight");
  if (weight) return weight;

  const flavor = readAttribute(attributes, "flavor");
  if (flavor) return flavor;

  const first = (attributes || []).find((attribute) =>
    String(attribute?.value ?? "").trim(),
  );
  if (first) return String(first.value).trim();

  const trimmedSku = typeof sku === "string" ? sku.trim() : "";
  return trimmedSku || null;
}

module.exports = {
  ATTRIBUTE_ALIASES,
  canonicalAttributeName,
  normalizeAttributes,
  readAttribute,
  variantLabel,
};
