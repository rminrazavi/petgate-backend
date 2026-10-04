"use strict";

// Customer-facing "health guarantee" badge. This is a fixed guarantee
// window (6 calendar months), not the actual remaining shelf life of the
// batch — the real expiryDate is never sent to the frontend (see
// getExpiryGuarantee() below and the GraphQL ProductExpiryGuarantee type).
const EXPIRY_GUARANTEE_MONTHS = 6;
const EXPIRY_GUARANTEE_LABEL = "تضمین سلامت ۶ ماهه";

// Product-level availability contract (ProductCard.availability). Backend
// computes this so the frontend never touches Inventory, stock, reserved,
// or batches directly (see ProductAvailability GraphQL type).
const LOW_STOCK_THRESHOLD = 5;

const AVAILABILITY_STATUS = {
  IN_STOCK: "IN_STOCK",
  LOW_STOCK: "LOW_STOCK",
  OUT_OF_STOCK: "OUT_OF_STOCK",
};

const AVAILABILITY_LABELS = {
  [AVAILABILITY_STATUS.IN_STOCK]: "موجود",
  [AVAILABILITY_STATUS.LOW_STOCK]: "موجودی کم",
  [AVAILABILITY_STATUS.OUT_OF_STOCK]: "ناموجود",
};

module.exports = {
  EXPIRY_GUARANTEE_MONTHS,
  EXPIRY_GUARANTEE_LABEL,
  LOW_STOCK_THRESHOLD,
  AVAILABILITY_STATUS,
  AVAILABILITY_LABELS,

  available(inventory) {
    return inventory.stock - inventory.reserved;
  },

  canReserve(inventory, quantity) {
    return this.available(inventory) >= quantity;
  },

  /**
   * Whether a variant has ANY batch currently sellable (`stock - reserved
   * > 0`). Used to derive Product/variant "Out of Stock" status — this is
   * a read-time computation, never a stored field, so it always reflects
   * current Inventory rows with no risk of going stale.
   */
  hasSellableStock(inventories) {
    if (!Array.isArray(inventories)) {
      return false;
    }

    return inventories.some(
      (item) => item != null && this.available(item) > 0,
    );
  },

  /**
   * Product-level ProductCard.availability contract. Aggregates sellable
   * quantity across every ACTIVE variant's Inventory batches (expired
   * batches already read as 0-available once reconciled — see
   * api::inventory.inventory#processExpiry/reconcileExpiry, which callers
   * must run before this). Never exposes Inventory rows or raw
   * stock/reserved — only the derived status/label/count.
   *
   * `variants` is the product's full (unfiltered) variants array; inactive
   * variants are excluded here so callers don't need to pre-filter.
   */
  getAvailability(variants) {
    const activeVariants = Array.isArray(variants)
      ? variants.filter((variant) => variant != null && variant.isActive)
      : [];

    const availableQuantity = activeVariants.reduce((sum, variant) => {
      const inventories = Array.isArray(variant.inventories)
        ? variant.inventories
        : [];

      const variantAvailable = inventories.reduce((subtotal, item) => {
        if (item == null) return subtotal;
        return subtotal + Math.max(0, this.available(item));
      }, 0);

      return sum + variantAvailable;
    }, 0);

    let status;

    if (availableQuantity <= 0) {
      status = AVAILABILITY_STATUS.OUT_OF_STOCK;
    } else if (availableQuantity <= LOW_STOCK_THRESHOLD) {
      status = AVAILABILITY_STATUS.LOW_STOCK;
    } else {
      status = AVAILABILITY_STATUS.IN_STOCK;
    }

    return {
      status,
      label: AVAILABILITY_LABELS[status],
      availableQuantity,
    };
  },

  /**
   * Calendar-month comparison (per spec: NOT a fixed 180-day window).
   * True when `expiryIso` falls on or before `now` plus
   * EXPIRY_GUARANTEE_MONTHS calendar months — i.e. "less than or equal to
   * 6 calendar months away".
   *
   * Uses Date#setMonth, which normalizes overflowing day-of-month (e.g.
   * Aug 31 + 6 months has no Feb 31, so it rolls into early March). This
   * is the standard JS calendar-month semantics and is an intentional,
   * disclosed choice rather than a fixed 180-day approximation.
   */
  isWithinGuaranteeWindow(expiryIso, now = new Date()) {
    if (!expiryIso) {
      return false;
    }

    const expiry = new Date(expiryIso);

    if (Number.isNaN(expiry.getTime())) {
      return false;
    }

    const threshold = new Date(now.getTime());
    threshold.setMonth(threshold.getMonth() + EXPIRY_GUARANTEE_MONTHS);

    return expiry.getTime() <= threshold.getTime();
  },

  /**
   * Single entry point for the customer-facing expiry badge. Combines
   * earliestFutureExpiry() (source-of-truth batch selection) with the
   * 6-calendar-month guarantee window, and returns ONLY the derived
   * label/months pair — never the underlying expiry date. Returns null
   * when there is no eligible future batch, or its expiry is more than 6
   * calendar months away (both cases: "show nothing").
   */
  getExpiryGuarantee(inventories, now = new Date()) {
    const expiry = this.earliestFutureExpiry(inventories);

    if (!expiry || !this.isWithinGuaranteeWindow(expiry, now)) {
      return null;
    }

    return {
      label: EXPIRY_GUARANTEE_LABEL,
      months: EXPIRY_GUARANTEE_MONTHS,
    };
  },

  /**
   * ProductCard display-selection rule ONLY — not FEFO reservation or
   * allocation logic (reserve/canReserve above are untouched and this
   * does not affect them).
   *
   * A ProductVariant can have multiple Inventory rows (batches) — the
   * relation is oneToMany with no uniqueness constraint, so this must
   * not assume a single row. Confirmed rule: among a variant's
   * inventory batches, a batch is eligible for display when BOTH:
   *   - its expiryDate is in the future (expired batches are ignored
   *     entirely — they don't count as "past expiry", they just drop
   *     out of consideration), AND
   *   - it has sellable stock, i.e. `stock - reserved > 0` (see
   *     available() above — reused here, not reimplemented).
   * From the remaining eligible batches, the EARLIEST expiryDate is
   * returned.
   *
   * Returns the expiry as an ISO date string, or null if no batch is
   * eligible (no inventories, all expired, or none with sellable
   * stock).
   */
  earliestFutureExpiry(inventories) {
    if (!Array.isArray(inventories) || inventories.length === 0) {
      return null;
    }

    const now = new Date();

    const eligibleDates = inventories
      .filter((item) => item != null)
      .filter((item) => this.available(item) > 0)
      .map((item) => item.expiryDate)
      .filter((value) => value != null)
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()) && date > now);

    if (eligibleDates.length === 0) {
      return null;
    }

    const earliest = new Date(
      Math.min(...eligibleDates.map((d) => d.getTime())),
    );

    return earliest.toISOString();
  },
};
