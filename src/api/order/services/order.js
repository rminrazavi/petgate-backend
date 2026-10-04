"use strict";

const { createCoreService } = require("@strapi/strapi").factories;
const cartPrice = require("../../../utils/cart-price");

module.exports = createCoreService("api::order.order", ({ strapi }) => ({
  async createFromCart(customerId, cartId, addressId, couponCode) {
    const cart = await strapi.documents("api::cart.cart").findOne({
      documentId: cartId,

      populate: {
        customer: true,

        cart_items: {
          populate: {
            product_variant: {
              populate: {
                product: { populate: { category: true } },
              },
            },
            product_bundle: {
              populate: {
                category: true,
                items: {
                  populate: {
                    productVariant: {
                      populate: { product: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!cart) {
      throw new Error("سبد خرید پیدا نشد");
    }

    if (cart.customer?.documentId !== customerId) {
      throw new Error("این سبد متعلق به شما نیست");
    }

    if (!cart.cart_items?.length) {
      throw new Error("سبد خرید خالی است");
    }

    const address = await strapi.documents("api::address.address").findOne({
      documentId: addressId,

      populate: {
        customer: true,
      },
    });

    if (!address) {
      throw new Error("آدرس پیدا نشد");
    }

    if (address.customer?.documentId !== customerId) {
      throw new Error("این آدرس متعلق به شما نیست");
    }

    // Recompute from live variant/bundle relations at checkout. Stored cart
    // totals and every client-provided number are deliberately ignored.
    const pricing = cartPrice.calculate(cart.cart_items);
    let couponResult = null;

    if (couponCode) {
      couponResult = await strapi
        .service("api::coupon.coupon")
        .apply(couponCode, pricing.totalPrice, {
          customerId,
          cartItems: cart.cart_items,
        });
    }

    // Build a flat list of {variantId, quantity} reservation operations
    // across BOTH plain variant items and bundle component items, plus
    // a frozen per-bundle-cart-item snapshot (component identity, sku,
    // name, quantity, unit price — all captured NOW). The snapshot is
    // not just for display: confirmPayment() below reads FROM the
    // snapshot, not from the live bundle, so what gets committed later
    // always matches what was reserved here — even if the bundle
    // definition changes in between.
    const reservationOps = [];
    const bundleSnapshotByCartItem = new Map();

    for (const item of cart.cart_items) {
      if (item.product_bundle) {
        const bundle = item.product_bundle;

        if (!bundle.isActive) {
          throw new Error(`باندل «${bundle.title}» دیگر در دسترس نیست`);
        }

        // Re-validate against LIVE availability at checkout time — the
        // bundle may have been deactivated or lost stock since it was
        // added to cart. Reuses the same service addBundleItem() uses,
        // no duplicated availability logic.
        const availability = await strapi
          .service("api::product-bundle.product-bundle")
          .getBundleAvailability(bundle.documentId);

        if (availability.availableQuantity < item.quantity) {
          throw new Error(`موجودی باندل «${bundle.title}» کافی نیست`);
        }

        const components = (bundle.items || [])
          .map((bundleItem) => {
            const variant = bundleItem.productVariant;
            const requiredQuantity = Number(bundleItem.quantity) || 0;

            if (!variant || requiredQuantity <= 0) return null;

            return {
              variantId: variant.documentId,
              sku: variant.sku ?? null,
              nameSnapshot: variant.product?.name ?? null,
              quantity: requiredQuantity,
              unitPriceAtPurchase: Number(
                variant.discountPrice ?? variant.price ?? 0,
              ),
            };
          })
          .filter(Boolean);

        for (const component of components) {
          reservationOps.push({
            variantId: component.variantId,
            quantity: component.quantity * item.quantity,
          });
        }

        bundleSnapshotByCartItem.set(item.documentId, {
          bundleNameSnapshot: bundle.title,
          bundleSlugSnapshot: bundle.slug,
          components,
        });
      } else if (item.product_variant) {
        reservationOps.push({
          variantId: item.product_variant.documentId,
          quantity: item.quantity,
        });
      }
    }

    // Single transactional reservation across every component of every
    // item in this order — the same primitive (`inventory.reserve`)
    // used for plain variants and bundle components alike, wrapped so
    // a failure on ANY of them rolls back ALL of them for this order.
    return strapi.db.transaction(async () => {
      await strapi
        .service("api::inventory.inventory")
        .reserveMany(reservationOps);

      if (couponResult?.couponId) {
        await strapi.service("api::coupon.coupon").consume(couponResult.couponId);
      }

      const order = await strapi.documents("api::order.order").create({
      data: {
        customer: customerId,

        address: addressId,

        orderStatus: "pending",

        totalPrice: pricing.totalPrice,

        discount: couponResult?.discount ?? 0,

        finalPrice: couponResult?.finalPrice ?? pricing.totalPrice,

        coupon: couponResult?.couponId ?? undefined,
      },
    });

    for (const item of cart.cart_items) {
      if (item.product_bundle) {
        const snapshot = bundleSnapshotByCartItem.get(item.documentId);

        await strapi.documents("api::order-item.order-item").create({
          data: {
            order: order.documentId,

            product_bundle: item.product_bundle.documentId,

            quantity: item.quantity,

            price: item.product_bundle.bundlePrice,

            bundleSnapshot: snapshot,
          },
        });
      } else if (item.product_variant) {
        await strapi.documents("api::order-item.order-item").create({
          data: {
            order: order.documentId,

            product_variant: item.product_variant.documentId,

            quantity: item.quantity,

            price:
              item.product_variant.discountPrice ?? item.product_variant.price,
          },
        });
      }
    }

      // Delete the CartItem rows rather than only detaching them:
      // detaching left orphaned rows behind on every checkout.
      for (const item of cart.cart_items) {
        await strapi.documents("api::cart-item.cart-item").delete({
          documentId: item.documentId,
        });
      }

      await strapi.documents("api::cart.cart").update({
        documentId: cart.documentId,
        data: {
          totalPrice: 0,
          discount: 0,
          finalPrice: 0,
          totalItems: 0,
        },
      });

      return await strapi.documents("api::order.order").findOne({
        documentId: order.documentId,

        populate: {
          address: true,
          customer: true,
          order_items: {
            populate: {
              product_variant: { populate: { product: true } },
              product_bundle: true,
              bundleSnapshot: { populate: { components: true } },
            },
          },
        },
      });
    });
  },

  async confirmPayment(orderId) {
    const order = await strapi.documents("api::order.order").findOne({
      documentId: orderId,

      populate: {
        order_items: {
          populate: {
            product_variant: true,
            product_bundle: true,
            bundleSnapshot: {
              populate: { components: true },
            },
          },
        },

        customer: true,

        address: true,
      },
    });

    if (!order) {
      throw new Error("سفارش پیدا نشد");
    }

    if (order.orderStatus === "paid") {
      return order;
    }

    // Commit operations are derived from the FROZEN bundleSnapshot, not
    // the live bundle — this is exactly why the snapshot exists: it
    // guarantees what gets committed here always matches what was
    // reserved at checkout, even if the bundle's components changed in
    // the meantime.
    const commitOps = [];

    for (const item of order.order_items) {
      if (item.product_bundle) {
        const components = item.bundleSnapshot?.components || [];

        for (const component of components) {
          if (!component.variantId || component.quantity <= 0) continue;

          commitOps.push({
            variantId: component.variantId,
            quantity: component.quantity * item.quantity,
          });
        }
      } else if (item.product_variant) {
        commitOps.push({
          variantId: item.product_variant.documentId,
          quantity: item.quantity,
        });
      }
    }

    // Single transactional commit across every component of every
    // order item — a failure on any of them leaves nothing committed,
    // rather than a partially-paid-out inventory state.
    return strapi.db.transaction(async () => {
      await strapi.service("api::inventory.inventory").commitMany(commitOps);

      await strapi.documents("api::order.order").update({
        documentId: order.documentId,
        data: {
          orderStatus: "paid",
          paidAt: new Date(),
        },
      });

      return await strapi.documents("api::order.order").findOne({
      documentId: order.documentId,

      populate: {
        address: true,

        customer: true,

        order_items: {
          populate: {
            product_variant: {
              populate: {
                product: true,
              },
            },
            product_bundle: true,
            bundleSnapshot: {
              populate: { components: true },
            },
          },
        },
      },
      });
    });
  },
}));
