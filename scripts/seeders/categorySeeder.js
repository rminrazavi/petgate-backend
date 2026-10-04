const categories = require("../data/categories");

const CATEGORY_UID = "api::category.category";

/**
 * Two passes, because `parents` is a self-referential relation: every
 * category has to exist before any of them can be linked.
 *
 *   1. create missing categories (without relations)
 *   2. reconcile sortOrder + parents for every seeded category
 *
 * Pass 2 runs on every seed, including against a database that already has
 * the categories, which is what repairs an existing DB where every category
 * was created as a root. It uses `connect`, which is a no-op for an
 * already-linked parent, so re-seeding never duplicates a relation and
 * never removes parents added by an editor in the admin panel.
 */
module.exports = async (strapi) => {
  console.log("📦 Seeding categories...");

  const bySlug = new Map();

  // ---- Pass 1: documents ----
  for (const category of categories) {
    const { parents, ...fields } = category;

    const existing = await strapi.documents(CATEGORY_UID).findFirst({
      filters: {
        slug: category.slug,
      },
    });

    if (existing) {
      console.log(`⏩ ${category.name} already exists`);
      bySlug.set(category.slug, existing);
      continue;
    }

    const created = await strapi.documents(CATEGORY_UID).create({
      data: {
        ...fields,
        publishedAt: new Date(),
      },
    });

    bySlug.set(category.slug, created);
    console.log(`✅ ${category.name}`);
  }

  // ---- Pass 2: hierarchy ----
  for (const category of categories) {
    const document = bySlug.get(category.slug);

    if (!document) continue;

    const parentIds = (category.parents ?? [])
      .map((slug) => bySlug.get(slug)?.documentId)
      .filter(Boolean);

    const missing = (category.parents ?? []).filter(
      (slug) => !bySlug.get(slug),
    );

    if (missing.length > 0) {
      // Loud, not silent: a typo in a parent slug would otherwise leave the
      // category as a root, i.e. silently promote it to an "animal".
      throw new Error(
        `Category "${category.slug}" references unknown parent slug(s): ${missing.join(", ")}`,
      );
    }

    await strapi.documents(CATEGORY_UID).update({
      documentId: document.documentId,
      data: {
        sortOrder: category.sortOrder ?? null,
        ...(parentIds.length > 0 ? { parents: { connect: parentIds } } : {}),
      },
    });

    console.log(
      parentIds.length > 0
        ? `🔗 ${category.name} → ${category.parents.join(", ")}`
        : `🌳 ${category.name} (animal root)`,
    );
  }

  const roots = categories.filter((category) => !category.parents?.length);

  console.log(
    `🐾 Animals (root categories): ${roots.map((item) => item.slug).join(", ")}`,
  );
};
