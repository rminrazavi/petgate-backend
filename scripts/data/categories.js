/**
 * Category taxonomy seed.
 *
 * Category is the single source of truth for the animal/product
 * classification (Product.petType was removed — see
 * database/migrations/2026.08.25T00.00.00.remove-product-pet-type.js), and
 * the animal is expressed purely as the ROOT of the category tree:
 *
 *   سگ (dog)                     <- root, no parents  => an "animal"
 *     ├── غذای خشک سگ (dog-food)
 *     ├── کنسرو (wet-food)
 *     └── ...
 *   گربه (cat)                    <- root, no parents  => an "animal"
 *     ├── غذای خشک گربه (cat-food)
 *     ├── خاک گربه (cat-litter)
 *     └── ...
 *
 * This shape is what the storefront depends on:
 *   - src/data/home/home.data.ts treats categories with no parents as the
 *     animals of the "پرفروش‌ترین بر اساس حیوان" section, and their
 *     children as the "newest per category" tabs.
 *   - productList(includeDescendants: true) walks parents/children
 *     (src/utils/category-tree.js) to collect an animal's whole subtree.
 *
 * Before this file declared `parents`, every seeded category was a root, so
 * every category was treated as an animal and each "animal" subtree
 * contained only itself.
 *
 * `parents` holds SLUGS; categorySeeder.js resolves them to documents in a
 * second pass, so ordering here does not matter and the depth is not
 * limited to two levels.
 *
 * Note on shared categories: کنسرو/تشویقی/مکمل/اسباب بازی/بهداشت genuinely
 * serve both animals, so they are children of both roots. A product filed
 * directly under a shared category therefore appears under BOTH animals —
 * that is a property of the data, not of the resolver. Products that must
 * belong to exactly one animal have to sit in an animal-specific category
 * (as the seeded products do).
 */
module.exports = [
  // ---- Animals (roots: no parents) ----
  { name: 'سگ', slug: 'dog', sortOrder: 1 },
  { name: 'گربه', slug: 'cat', sortOrder: 2 },

  // ---- Animal-specific subcategories ----
  { name: 'غذای خشک سگ', slug: 'dog-food', sortOrder: 1, parents: ['dog'] },
  { name: 'غذای خشک گربه', slug: 'cat-food', sortOrder: 1, parents: ['cat'] },
  { name: 'خاک گربه', slug: 'cat-litter', sortOrder: 6, parents: ['cat'] },

  // ---- Shared subcategories (belong to both animals) ----
  { name: 'کنسرو', slug: 'wet-food', sortOrder: 2, parents: ['dog', 'cat'] },
  { name: 'تشویقی', slug: 'treats', sortOrder: 3, parents: ['dog', 'cat'] },
  { name: 'مکمل', slug: 'supplements', sortOrder: 4, parents: ['dog', 'cat'] },
  { name: 'اسباب بازی', slug: 'toys', sortOrder: 5, parents: ['dog', 'cat'] },
  { name: 'بهداشت', slug: 'hygiene', sortOrder: 7, parents: ['dog', 'cat'] }
];
