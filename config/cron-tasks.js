"use strict";

/**
 * Cron tasks for critical background operations.
 * 
 * 1. releaseExpiredOrders: Cancel pending orders older than 15 minutes
 *    and release their reserved inventory. This prevents "stuck" orders
 *    from blocking stock indefinitely when payment times out.
 *
 * 2. processExpiredInventory: Move stock from active batches to stockExpired
 *    once expiryDate has passed. This is idempotent so running it every minute
 *    (or even more frequently) is safe.
 */

module.exports = {
  releaseExpiredOrders: {
    task: async ({ strapi }) => {
      const cutoffTime = new Date(Date.now() - 15 * 60 * 1000);

      const expiredOrders = await strapi
        .documents("api::order.order")
        .findMany({
          filters: {
            orderStatus: { $in: ["pending", "waiting_payment"] },
            createdAt: {
              $lt: cutoffTime,
            },
          },
          populate: {
            coupon: true,
            order_items: {
              populate: {
                product_variant: true,
                product_bundle: {
                  populate: {
                    items: {
                      populate: { productVariant: true },
                    },
                  },
                },
                bundleSnapshot: {
                  populate: { components: true },
                },
              },
            },
          },
        });

      for (const order of expiredOrders) {
        try {
          await strapi.db.transaction(async () => {
          // Release inventory for each item
          for (const item of order.order_items ?? []) {
            if (item.product_bundle && item.bundleSnapshot) {
              // Bundle: release all component variants
              const components = item.bundleSnapshot?.components ?? [];
              for (const component of components) {
                if (component.variantId && component.quantity) {
                  // eslint-disable-next-line no-await-in-loop
                  await strapi
                    .service("api::inventory.inventory")
                    .release(component.variantId, component.quantity * item.quantity);
                }
              }
            } else if (item.product_variant) {
              // Plain variant: release directly
              // eslint-disable-next-line no-await-in-loop
              await strapi
                .service("api::inventory.inventory")
                .release(item.product_variant.documentId, item.quantity);
            }
          }

          if (order.coupon?.documentId) {
            // eslint-disable-next-line no-await-in-loop
            await strapi
              .service("api::coupon.coupon")
              .releaseUsage(order.coupon.documentId);
          }

          // Mark order as cancelled
          // eslint-disable-next-line no-await-in-loop
          await strapi.documents("api::order.order").update({
            documentId: order.documentId,
            data: {
              orderStatus: "cancelled",
            },
          });

          });

          strapi.log.info(
            `[cron] Released inventory for expired order ${order.documentId}`,
          );
        } catch (error) {
          strapi.log.error(
            `[cron] Error releasing inventory for order ${order.documentId}:`,
            error.message,
          );
        }
      }
    },

    options: {
      rule: "*/15 * * * *", // Every 15 minutes
    },
  },

  processExpiredInventory: {
    task: async ({ strapi }) => {
      try {
        // Get all variants with inventories
        const variants = await strapi
          .documents("api::product-variant.product-variant")
          .findMany({
            populate: {
              inventories: true,
            },
          });

        let processedBatches = 0;

        for (const variant of variants) {
          if (!Array.isArray(variant.inventories)) continue;

          // eslint-disable-next-line no-await-in-loop
          await strapi
            .service("api::inventory.inventory")
            .reconcileExpiry(variant.inventories);

          processedBatches += variant.inventories.length;
        }

        strapi.log.info(
          `[cron] Processed expiry on ${processedBatches} inventory batch(es)`,
        );
      } catch (error) {
        strapi.log.error(
          `[cron] Error processing expired inventory: ${error.message}`,
        );
      }
    },

    options: {
      rule: "0 * * * *", // Every hour
    },
  },
};
