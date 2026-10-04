# PETGATE — INTEGRATION BASELINE (Phase 0)

Date: 2026-10-05. Environment: Node v22.23.1, git. **No network** (registry fetch
timed out), **no pnpm / npm / npx / corepack / yarn**, **no PostgreSQL**, no Docker.
Neither repo ships `node_modules`. Neither archive was a git repo; both were
`git init`-ed and imported as-is (commit "Import baseline snapshot as received").

**GATE: NOT MET.** Neither app can boot in this environment. Phase 1 must not start
until the "NOT RUN" rows below are run on a machine with network + PostgreSQL.

## 1. Results

| Step | Result | Evidence |
|---|---|---|
| FE `pnpm install` | NOT RUN: pnpm absent, no network | `command -v pnpm` -> absent |
| FE `pnpm check:system` (run as `node scripts/check-system.mjs`) | **PASS: 21 checks, 0 errors, 0 warnings** | tail: `OK — 0 errors, 0 warning(s)` |
| FE `pnpm build` (Next 16.3.4 + Tailwind 4) | NOT RUN: `next`, `@tailwindcss/postcss` not installed | |
| FE `pnpm typecheck` | NOT RUN (inconclusive attempt): sandbox tsc 5.6.3 gives 53 errors, all caused by missing deps: 44x TS2307 (`next`, `next/link`, `next/navigation`), 8x TS2580 (`process`, no @types/node), 1x TS2339 in `c/[slug]/page.tsx:137` (narrowing after `notFound()`, which is untyped without Next). Not a pass, not a fail. | |
| FE `pnpm lint` | NOT RUN: `eslint-config-next` absent | |
| FE fixture-contract | **53 passed, 0 failed** (before and after path fix) | `FIXTURE-CONTRACT-RESULTS.txt` |
| FE account / checkout / category-nav / discovery / info / pet-profile / search contracts | **64/0, 89/0, 26/26, 61/0, 103/0, 106/0, 81/0** | each script's tail |
| FE plp-contract | **FAIL (pre-existing, stale script)**: `TypeError: tax.buildCategoryIndex is not a function`; source exports `buildCanonicalIndex`. Was unrunnable before the path fix; now runs and fails on this. | |
| FE presenter-gaps | **FAIL (pre-existing, stale script)**: its hand-built variants omit `installment`, which `types/domain/product.ts` declares required (`Installment \| null`); `present.ts:158` then throws. Script fixture is wrong, not the presenter. | |
| FE presenter-parity | NOT RUNNABLE: needs a previous archive; now says so via `PETGATE_PARITY_OLD_ROOT` instead of reading a nonexistent path | |
| BE install / `strapi build` / GraphQL schema / boot | NOT RUN: no npm/pnpm, no network, no node_modules | |
| BE PostgreSQL + `npm run seed` | NOT RUN: no PostgreSQL binary | |
| BE `npm test` (jest) | NOT RUN: jest not installed. **Also: there is no `tests/` directory**, so it would discover 0 suites | `jest.config.js testMatch **/tests/**/*.test.js` |
| BE `node jest-lite.js` | **0 passed, 0 failed, 0 total — not a pass**: no test files exist | tail: `Tests: 0 passed, 0 failed / 0 total` |
| BE syntax check (`node --check` on all 201 tracked .js) + JSON parse of every schema | **201/201 OK, all JSON OK** | |

## 2. Fixes made (one commit each)
FE `e609cd6` Derive contract script paths from location and env:
new `docs/validation/contract-env.mjs` (ROOT from file location or `PETGATE_ROOT`; esbuild/react from
`PETGATE_MODULES` -> `<root>/node_modules` -> the existing search in `plp-harness/env.mjs`; output to
`<PETGATE_HARNESS_OUT|root/.harness>/contracts`, git-ignored). Edited `fixture-contract.mjs`,
`plp-contract.mjs`, `presenter-gaps.mjs`, `presenter-parity.mjs`, `next-link-stub.cjs`. **No assertion changed.**
Also committed: the 4 `*-RESULTS.txt` files the contracts rewrite on every run (root path + timestamp only).
BE `f48b021` Ignore every env file except the example (`.env*`, `!.env.example`).
BE `0f2c161` Replace live-looking secrets in `.env.example` with placeholders.

## 3. Known facts: verification
1. Version mismatch: **CONFIRMED.** No `categoryContent`, `complementaryProducts`, `category-seo.js`,
   `scripts/data/category-content.js`, canonical-slug migration in back.zip. Seed has `dog-food`, `cat-food`,
   `cat-litter`; FE snapshot (fingerprint abb498934a81d9f6) expects `dry-food` (dog+cat), `litter`
   (cat, «خاک بستر»), with seeded content for dry-food / wet-food / treats / litter.
   `utils/inventory.js` exists (expiry helper present). **Extra:** FE `package.json` has NO
   `sync:categories` / `check:categories` scripts although the generated file and brief reference them.
2. Nothing built: **CONFIRMED** (no node_modules, no lockfile-installed tree, no .next, no dist).
3. Two catalogue modes: **CONFIRMED.** Mode read in `config/catalog-mode.ts`; PDP, related and **reviews**
   sources dispatch on it; `catalog-source.ts` and `home/data/products.ts` import fixtures unconditionally.
4. No auth / in-memory cart / checkout no submit / account boundary / pet localStorage / wishlist removed:
   **CONFIRMED.** No `src/app/api`, no middleware. Wishlist appears only in a comment in `AccountView.tsx`.
5. Backend shapes: **CONFIRMED.** Cart routes all `auth: {}`; checkout reads `{cartId, addressId, couponCode}`;
   `Address.address` is `blocks`; only `gateways/sep.js`; status route `auth: {}`; redirect appends
   `?orderId=<resNum>` and `resNum = order.documentId`. **Extra: `PAYMENT_CURRENCY` is in .env.example
   but no code reads it.**
6. Weak secrets: **CONFIRMED and worse:** 6 Strapi secrets in `.env` were byte-identical to values in the
   committed `.env.example` (now replaced). Values never printed.

## 4. Other findings
* BE ships `src.zip` (211 files): an OLDER copy of `src/` (missing expert-profile, footer-column,
  trust-promise). Dead weight / confusion risk. Not deleted (asking first).
* BE `config/database.js` falls back to hardcoded DB passwords when `DATABASE_PASSWORD` is unset.
* 17 BE files still reference wishlist (Phase 8).
* AGENTS.md forbids writing Next code before reading `node_modules/next/dist/docs/`; those docs do not
  exist until install. That blocks Phase 3+ (Route Handlers) here.

## 5. Rotate (you, not me)
APP_KEYS, API_TOKEN_SALT, ADMIN_JWT_SECRET, TRANSFER_TOKEN_SALT, JWT_SECRET, ENCRYPTION_KEY,
DATABASE_PASSWORD. SEP_TERMINAL_ID in .env is still the placeholder (needs a real sandbox terminal).
The old values remain in each repo's first baseline commit: do not push that history as-is.

## 6. To close the gate (on a machine with network + Postgres)
FE: `pnpm install && pnpm verify`. BE: `npm ci` (package-lock present) or `pnpm install`,
`npm run build`, `npm run develop` against local Postgres, `npm run seed`, then GraphQL introspection.
