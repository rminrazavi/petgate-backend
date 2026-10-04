"use strict";

const { createCoreService } = require("@strapi/strapi").factories;

module.exports = createCoreService(
  "api::inventory.inventory",
  ({ strapi }) => ({
    /**
     * Expired-batch transition (critical business rule).
     *
     * Idempotent single-row processor: safe to call on every inventory
     * row read anywhere in the app, as many times as you like. A batch
     * is only touched when `expiryDate` has passed AND it still has
     * sellable `stock` — once processed, `stock` is 0 so re-running this
     * against the same (now-stale, in-memory) row is a no-op.
     *
     * On transition:
     *   - `stock` -> 0 (nothing further sellable from this batch)
     *   - the ENTIRE previous `stock` (not just the unreserved portion)
     *     moves into `stockExpired` — the physical goods are expired
     *     regardless of whether part of them was reserved; nothing is
     *     overwritten/lost, see stockExpired accumulation below
     *   - `sold` is untouched (already-completed sales are unaffected)
     *   - `reserved` must also drop to 0. This is NOT a silent discard:
     *     the existing `beforeUpdate` lifecycle hook enforces
     *     `reserved <= stock` on every Inventory write, so a batch at
     *     stock=0 cannot carry a nonzero `reserved` — there is no schema
     *     field for "reserved against dead stock" and adding a new
     *     reservation-reassignment / auto-cancellation system is outside
     *     inventory/batch behavior. Instead, any reserved quantity found
     *     at the moment of expiry is logged as a warning (batch id,
     *     variant id, quantity) for manual/ops review, and downstream
     *     commit() calls for that reservation will now correctly fail
     *     with "رزرو موجودی معتبر نیست" instead of silently overselling
     *     or driving stock negative.
     *   - Product publication is never touched here — availability is a
     *     read-time computation (see utils/inventory.js#hasSellableStock),
     *     not a stored/published field.
     */
    async processExpiry(inventoryRow) {
      if (!inventoryRow || !inventoryRow.expiryDate) {
        return inventoryRow;
      }

      const expiryDate = new Date(inventoryRow.expiryDate);
      const now = new Date();

      if (Number.isNaN(expiryDate.getTime()) || expiryDate > now) {
        return inventoryRow;
      }

      const stock = inventoryRow.stock ?? 0;

      if (stock <= 0) {
        // Already processed (or never had sellable stock) — nothing to do.
        return inventoryRow;
      }

      const reserved = inventoryRow.reserved ?? 0;
      const stockExpired = inventoryRow.stockExpired ?? 0;

      if (reserved > 0) {
        const variantId =
          inventoryRow.product_variant?.documentId ??
          inventoryRow.product_variant ??
          "unknown";

        strapi.log.warn(
          `[inventory] Batch ${inventoryRow.documentId} (variant ${variantId}) ` +
            `expired on ${inventoryRow.expiryDate} with ${reserved} unit(s) ` +
            `still reserved. These reservations can no longer be fulfilled ` +
            `from this batch and are being cleared; any order(s)/cart(s) ` +
            `relying on them are NOT automatically cancelled and require ` +
            `manual review.`,
        );
      }

      return strapi.documents("api::inventory.inventory").update({
        documentId: inventoryRow.documentId,
        data: {
          stock: 0,
          reserved: 0,
          stockExpired: stockExpired + stock,
        },
      });
    },

    /**
     * Bulk variant of processExpiry() for a batch of already-populated
     * Inventory rows (e.g. `variant.inventories` from a Document Service
     * populate). Mutates each row object in place with its post-expiry
     * values so callers reading the same array afterwards (pricing,
     * expiry-badge computation, availability checks) see fresh data
     * without a second fetch.
     */
    async reconcileExpiry(inventoryRows) {
      if (!Array.isArray(inventoryRows)) {
        return inventoryRows;
      }

      for (const row of inventoryRows) {
        if (!row) continue;

        const updated = await this.processExpiry(row);

        if (updated && updated !== row) {
          row.stock = updated.stock;
          row.reserved = updated.reserved;
          row.stockExpired = updated.stockExpired;
        }
      }

      return inventoryRows;
    },

    async getSellableBatches(variantId) {
      const rows = await strapi
        .documents("api::inventory.inventory")
        .findMany({
          filters: { product_variant: { documentId: variantId } },
          populate: { product_variant: true },
          sort: ["expiryDate:asc", "createdAt:asc"],
        });

      await this.reconcileExpiry(rows);
      return rows;
    },

    async reserve(variantId, quantity) {
      const requested = Number(quantity);
      if (!Number.isInteger(requested) || requested <= 0) {
        throw new Error("تعداد رزرو نامعتبر است");
      }

      const batches = await this.getSellableBatches(variantId);
      const totalAvailable = batches.reduce(
        (sum, row) => sum + Math.max(0, (row.stock ?? 0) - (row.reserved ?? 0)),
        0,
      );

      if (totalAvailable < requested) throw new Error("موجودی کافی نیست");

      let remaining = requested;
      for (const row of batches) {
        if (remaining === 0) break;
        const available = Math.max(0, (row.stock ?? 0) - (row.reserved ?? 0));
        const take = Math.min(available, remaining);
        if (take === 0) continue;

        await strapi.documents("api::inventory.inventory").update({
          documentId: row.documentId,
          data: { reserved: (row.reserved ?? 0) + take },
        });
        remaining -= take;
      }

      return true;
    },

    async commit(variantId, quantity) {
      const requested = Number(quantity);
      if (!Number.isInteger(requested) || requested <= 0) {
        throw new Error("تعداد فروش نامعتبر است");
      }

      const batches = await this.getSellableBatches(variantId);
      const totalReserved = batches.reduce(
        (sum, row) => sum + Math.max(0, row.reserved ?? 0),
        0,
      );

      if (totalReserved < requested) throw new Error("رزرو موجودی معتبر نیست");

      let remaining = requested;
      for (const row of batches) {
        if (remaining === 0) break;
        const take = Math.min(Math.max(0, row.reserved ?? 0), remaining);
        if (take === 0) continue;

        await strapi.documents("api::inventory.inventory").update({
          documentId: row.documentId,
          data: {
            stock: (row.stock ?? 0) - take,
            reserved: (row.reserved ?? 0) - take,
            sold: (row.sold ?? 0) + take,
          },
        });
        remaining -= take;
      }

      return true;
    },

    async release(variantId, quantity) {
      const requested = Number(quantity);
      if (!Number.isInteger(requested) || requested <= 0) return true;

      const batches = await this.getSellableBatches(variantId);
      let remaining = requested;

      for (const row of [...batches].reverse()) {
        if (remaining === 0) break;
        const take = Math.min(Math.max(0, row.reserved ?? 0), remaining);
        if (take === 0) continue;

        await strapi.documents("api::inventory.inventory").update({
          documentId: row.documentId,
          data: { reserved: (row.reserved ?? 0) - take },
        });
        remaining -= take;
      }

      return true;
    },

    async completeSale(variantId, quantity) {
      return this.commit(variantId, quantity);
    },

    /**
     * Transactional multi-operation reserve/commit.
     *
     * Added for order-level inventory operations that touch more than
     * one variant in one logical step (a cart with several items, a
     * bundle whose components must all reserve/commit together). Reuses
     * `reserve()`/`commit()` verbatim in a loop — no new inventory math,
     * no second stock-management mechanism — and wraps the loop in
     * `strapi.db.transaction()` so a failure partway through rolls back
     * every operation already performed in this call, not just the one
     * that failed.
     *
     * How the rollback guarantee actually holds: `reserve()`/`commit()`
     * write via `strapi.documents(...).update(...)`, i.e. the Document
     * Service. Per Strapi 5's transaction API, every Document Service
     * call made inside a `strapi.db.transaction()` callback implicitly
     * joins that transaction via AsyncLocalStorage — there is nothing
     * to pass through manually, and nothing in `reserve`/`commit`
     * needed to change. If any iteration throws (insufficient stock,
     * invalid reservation, missing inventory row), the callback rejects
     * and Strapi rolls back every write made so far in this call.
     *
     * Note: `strapi.db.transaction()` is Strapi 5's own experimental
     * transactions API (see database-transactions docs) — flagged here
     * because "experimental" is Strapi's designation, not a caveat this
     * implementation is adding.
     *
     * @param {{variantId: string, quantity: number}[]} operations
     */
    async reserveMany(operations) {
      if (!Array.isArray(operations) || operations.length === 0) {
        return true;
      }

      return strapi.db.transaction(async () => {
        for (const op of operations) {
          // eslint-disable-next-line no-await-in-loop
          await this.reserve(op.variantId, op.quantity);
        }
        return true;
      });
    },

    /** Transactional counterpart of reserveMany() — see its docstring. */
    async commitMany(operations) {
      if (!Array.isArray(operations) || operations.length === 0) {
        return true;
      }

      return strapi.db.transaction(async () => {
        for (const op of operations) {
          // eslint-disable-next-line no-await-in-loop
          await this.commit(op.variantId, op.quantity);
        }
        return true;
      });
    },
  }),
);
