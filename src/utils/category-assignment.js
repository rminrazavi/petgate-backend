"use strict";

/**
 * SHARED PRODUCTS / CATEGORY ARCHITECTURE — the read-time authority.
 *
 * THE PROBLEM
 * -----------
 * A product can genuinely belong to more than one animal, e.g. a
 * supplement sold for both سگ and گربه. Product owned a single
 * `category` (manyToOne), so the catalogue could express dog-only or
 * cat-only and nothing else. The removed `petType` enum is NOT coming
 * back: Category stays the source of truth for species and taxonomy.
 *
 * THE SMALLEST CORRECT SOLUTION
 * -----------------------------
 *   Product.category    manyToOne   — the PRIMARY category. Unchanged,
 *                                     so every existing product, every
 *                                     breadcrumb and every canonical
 *                                     trail keeps working untouched.
 *   Product.categories  manyToMany  — the FULL assignment set. Added.
 *
 * The two are reconciled at READ time by this module rather than by a
 * write-time lifecycle that would have to mutate relation payloads in
 * four different shapes (documentId string, `{connect:[...]}`, numeric
 * primary key, admin-panel picker object) at the db layer. Nothing has
 * to be migrated, nothing has to be backfilled, and a product that only
 * ever had `category` behaves exactly as it did before:
 *
 *   effective categories = [primary, ...categories]   (deduplicated)
 *   primary             = category ?? categories[0]
 *
 * so the model supports dog-only, cat-only, dog+cat, and any future
 * multi-category assignment, with one relation added and none changed.
 *
 * Filtering follows the same rule: `categoryMatchFilter` matches a
 * product through EITHER side, which is what makes a shared product
 * appear in both the dog rail and the cat rail from one query.
 */

/** Deduplicates category-ish objects by documentId, order preserved. */
function dedupeCategories(categories) {
  const seen = new Set();
  const result = [];

  for (const category of categories) {
    const id = category?.documentId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(category);
  }

  return result;
}

/**
 * Every category a product is assigned to, primary first.
 *
 * Accepts a populated product (Document Service shape). A product with
 * only the legacy single relation returns exactly one entry, so no
 * caller needs to know which of the two shapes it is looking at.
 */
function effectiveCategories(product) {
  if (!product) return [];

  const primary = product.category ? [product.category] : [];
  const many = Array.isArray(product.categories) ? product.categories : [];

  return dedupeCategories([...primary, ...many]);
}

/**
 * The category that represents the product: its explicit primary when it
 * has one, otherwise the first of its multi-assignment. Breadcrumbs, the
 * canonical trail and the related-products rail all key off this, so a
 * product assigned ONLY through `categories` still gets a real trail
 * instead of none.
 */
function primaryCategory(product) {
  return effectiveCategories(product)[0] ?? null;
}

/** documentIds of every category a product is assigned to. */
function effectiveCategoryIds(product) {
  return effectiveCategories(product).map((category) => category.documentId);
}

/**
 * The filter that selects products assigned to any of `categoryIds`
 * through EITHER relation.
 *
 * Returns null for an empty input so callers can treat "no category
 * scope" as "no category clause" rather than as "match nothing".
 */
function categoryMatchFilter(categoryIds) {
  const ids = [...new Set((categoryIds || []).filter(Boolean))];

  if (ids.length === 0) return null;

  return {
    $or: [
      { category: { documentId: { $in: ids } } },
      { categories: { documentId: { $in: ids } } },
    ],
  };
}

/**
 * True when the product is assigned to the category, through either
 * relation. Used by tests and by the rails' de-duplication.
 */
function isAssignedToCategory(product, categoryDocumentId) {
  if (!categoryDocumentId) return false;
  return effectiveCategoryIds(product).includes(categoryDocumentId);
}

/**
 * Category -> the GraphQL `ProductCardCategory` contract. A category
 * missing a name or a slug cannot be linked to, so it is dropped rather
 * than rendered as a dead breadcrumb.
 */
function toCategoryRef(category) {
  if (!category?.documentId || !category.name || !category.slug) return null;

  return {
    documentId: category.documentId,
    name: category.name,
    slug: category.slug,
  };
}

/** Every category of a product, already in the GraphQL contract shape. */
function toCategoryRefs(product) {
  return effectiveCategories(product).map(toCategoryRef).filter(Boolean);
}

/** The populate fragment every product read needs for the above to work. */
const CATEGORY_POPULATE = {
  category: true,
  categories: true,
};

module.exports = {
  CATEGORY_POPULATE,
  categoryMatchFilter,
  dedupeCategories,
  effectiveCategories,
  effectiveCategoryIds,
  isAssignedToCategory,
  primaryCategory,
  toCategoryRef,
  toCategoryRefs,
};
