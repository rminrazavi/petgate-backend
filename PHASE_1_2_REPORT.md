# MOPET Strapi Phase 1 + Phase 2 Report

## Phase 1: Commerce Core

Audited Product, ProductVariant, Inventory, Category, Brand, Campaign, Coupon, Cart, CartItem, Order, OrderItem, Review, Wishlist, Customer, Address, Payment, Setting, ProductBundle, and ProductBundleItem schemas plus their services, controllers, lifecycles, GraphQL extensions, bootstrap, permissions, migrations, seeders, cron tasks, and shared utilities.

Relations were checked bidirectionally across all 33 API schemas. Every declared `mappedBy`/`inversedBy` target resolves. Product remains the identity, ProductVariant remains the sellable SKU and price owner, Inventory remains the stock owner, and Category remains the only commerce taxonomy. A dead utility that emitted the nonexistent `Product.categories` field was removed; the supported contract is the singular `Product.category` field.

Price selection is now centralized in `utils/price#getEffectivePrice`: a finite non-negative `discountPrice` is effective only when it is not greater than regular `price`. Cart and bundle calculations use the same rule. ProductVariant lifecycle validation now handles partial updates by validating against the persisted counterpart value instead of checking only when both fields happen to be in one payload.

Inventory availability remains `stock - reserved`; `stockExpired` is an accumulated physical-expiry counter and is not subtracted again. The expiry transition used an invalid Strapi 5 Document Service update signature and was corrected. Reservation, commit, release, bundle component reservation, frozen bundle snapshots, cart recalculation, and order-item persistence were traced end to end.

Payment verification now commits inventory/order state and marks the Payment successful in one database transaction. Previously Payment could be marked successful before inventory commit; a commit failure then made retries return early forever. Expired-order inventory release, coupon usage release, and order cancellation now share one transaction.

Coupon hardening adds customer allowlists, product/category restrictions, once-per-customer checking, positive/range validation, normalized codes, and transactional consume/release accounting. Client prices remain ignored. Product/category restrictions calculate against eligible cart lines only.

Best-seller logic continues to aggregate real `Inventory.sold` across variants. No `isBestSeller`, synthetic inventory, sales, ratings, or duplicate product/category model was introduced. Review rollups remain sourced from approved Review rows.

Meilisearch is now enabled only when `MEILISEARCH_HOST` is a valid HTTP(S) URL. Missing/invalid environment configuration disables the plugin instead of passing an invalid host or inventing one.

GraphQL custom contracts were audited for singular `category`; no live ProductCard `categories` field remains. Public/authenticated bootstrap permissions already validate actions against Strapi's registered action set, and the valid HomePage permission is retained.

## Phase 2: CMS

HomePage was extended with grouped editorial components for utility bar, brand tagline, pet picker, trust, category hub, bestseller, guide, Problem Finder framing, calculator framing, bundles, expert, magazine, not-found help, app prompt, FAQ framing, and back-to-top label. Existing banner/product/category relations and API contracts were preserved.

Created reusable `TrustPromise`, `ExpertProfile`, and `FooterColumn` collection types with ordering, active state, publishing, media, links, and stable keys where appropriate. The existing Menu model was upgraded in place as the Navigation model instead of creating a duplicate navigation taxonomy; legacy fields and UID remain for compatibility, while keyed locations and bounded two-level items were added. Category targets reference Category rather than copying its tree.

Setting was extended for app-store, support/legal, and reusable social links while retaining existing trust items and legal trust symbols. Banner gained eyebrow support, image-only media constraints, defaults, ordering validation, and a start/end scheduling lifecycle. FAQ remains the single existing FAQ model and now has required content plus safe ordering/active defaults. Campaign remains the single existing Campaign model.

Public read permissions were added for TrustPromise, ExpertProfile, and FooterColumn; Navigation continues through the existing Menu UID. Shadow CRUD exposes these CMS types through the current GraphQL architecture. No public write permissions were granted.

An idempotent, non-destructive migration bridges real existing `Setting.trustItems` into TrustPromise rows by stable key. It creates missing rows only and never overwrites editor-owned content. Exact homepage/navigation/footer/expert editorial rows were not invented because the supplied archive does not contain the referenced approved editorial constants.

## Root Causes

1. Effective price had several direct `discountPrice ?? price` implementations and accepted invalid persisted discounts defensively.
2. ProductVariant partial updates skipped discount validation when only one price field changed.
3. Inventory expiry called the Strapi 5 Document Service with the wrong update signature.
4. Payment was persisted as successful before inventory commit, breaking retry recovery on commit failure.
5. Coupon usage was incremented during validation, before order creation or inventory reservation succeeded.
6. Expired-order release and cancellation were not atomic.
7. A dead taxonomy helper referenced a `Product.categories` relation that does not exist in the authoritative schema.
8. Meilisearch configuration did not guard missing or malformed environment hosts.
9. CMS architecture had homepage relations but lacked grouped editorial framing and reusable trust/expert/footer structures.

## Important Files Changed

- `src/utils/price.js`
- `src/utils/cart-price.js`
- `src/utils/bundle-price.js`
- `src/api/product-variant/content-types/product-variant/lifecycles.js`
- `src/api/inventory/services/inventory.js`
- `src/api/order/services/order.js`
- `src/api/payment/services/payment.js`
- `src/api/coupon/content-types/coupon/schema.json`
- `src/api/coupon/content-types/coupon/lifecycles.js`
- `src/api/coupon/services/coupon.js`
- `config/cron-tasks.js`
- `config/plugins.js`
- `src/api/home-page/content-types/home-page/schema.json`
- `src/api/menu/content-types/menu/schema.json`
- `src/api/setting/content-types/setting/schema.json`
- `src/api/banner/content-types/banner/schema.json`
- `src/api/banner/content-types/banner/lifecycles.js`
- `src/api/faq/content-types/faq/schema.json`
- `src/api/category/content-types/category/schema.json`
- `src/extensions/graphql/category-navigation.js`
- `src/api/trust-promise/**`
- `src/api/expert-profile/**`
- `src/api/footer-column/**`
- `src/components/editorial/**`
- `src/components/navigation/**`
- `src/components/footer/**`
- `src/components/site/link.json`
- `src/bootstrap/cms-foundation.js`
- `src/bootstrap/permissions.js`
- `src/index.js`
- Removed dead `src/utils/category-assignment.js`

## Verification

- JavaScript syntax: 195 files checked with `node --check`, 0 failures.
- JSON parsing: 57 JSON files parsed, 0 failures.
- Relation audit: 33 API schemas checked, 0 unresolved reciprocal relations.
- Commerce utility execution: 9 assertions passed for valid/invalid effective prices, cart totals, bundle totals, and component-derived availability.
- Repository lightweight test harness: executed successfully, but the archive contains 0 discovered test files, so result was 0 passed / 0 failed / 0 total. This is not reported as a test pass.
- `petType`: no schema attribute or runtime access exists. Remaining text occurrences are historical migration/comments documenting removal; the required removal migration is retained.
- Strapi build, GraphQL schema generation, and runtime smoke test: not executable in this environment because the archive has no `node_modules` and no npm, pnpm, yarn, or corepack executable. The sandbox has no internet access, so dependencies cannot be installed here.
- Content migration: exact approved editorial constants were not present in the supplied backend archive. No replacement copy or fake CMS rows were invented.

## Deferred

Problem Finder engine/content, Pet Profile expansion, Food Calculator/feeding tables, replenishment, SMS reminders, abandoned-cart automation, Smart Coupons rules engine, RFM/segmentation, marketing automation, Torob scraping, competitor intelligence, and automated pricing remain deferred as requested.

## Final Status

BLOCKED

## Archive Diff Inventory

```text
config/cron-tasks.js
config/plugins.js
src/api/banner/content-types/banner/lifecycles.js
src/api/banner/content-types/banner/schema.json
src/api/category/content-types/category/schema.json
src/api/coupon/content-types/coupon/lifecycles.js
src/api/coupon/content-types/coupon/schema.json
src/api/coupon/services/coupon.js
src/api/expert-profile
src/api/faq/content-types/faq/schema.json
src/api/footer-column
src/api/home-page/content-types/home-page/schema.json
src/api/inventory/services/inventory.js
src/api/menu/content-types/menu/schema.json
src/api/order/services/order.js
src/api/payment/services/payment.js
src/api/product-variant/content-types/product-variant/lifecycles.js
src/api/setting/content-types/setting/schema.json
src/api/trust-promise
src/bootstrap/cms-foundation.js
src/bootstrap/permissions.js
src/components/editorial
src/components/footer
src/components/navigation
src/components/site/link.json
src/extensions/graphql/category-navigation.js
src/index.js
src/utils/bundle-price.js
src/utils/cart-price.js
src/utils/price.js
```
