"use strict";

/**
 * Minimal in-process TTL cache for read-only, request-independent
 * lookups (category trees, category popularity ranking).
 *
 * Why a TTL and not a plain Map: a process-lifetime Map would serve a
 * stale category tree forever after an editor changes the taxonomy. A
 * short TTL collapses the burst of identical queries a single page render
 * produces, then lets real changes through.
 *
 * Deliberately not a distributed cache: it holds a handful of small
 * arrays, and correctness never depends on two instances agreeing.
 */

function createTtlCache({ ttlMs = 30_000, maxEntries = 200 } = {}) {
  const store = new Map();

  function prune() {
    const now = Date.now();

    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) store.delete(key);
    }

    // Bound memory even if callers use unbounded key spaces.
    while (store.size > maxEntries) {
      const oldestKey = store.keys().next().value;
      store.delete(oldestKey);
    }
  }

  return {
    /**
     * Returns the cached value, or awaits and caches `factory()`.
     * Concurrent callers share one in-flight promise; a rejection is
     * never cached.
     */
    async resolve(key, factory) {
      const now = Date.now();
      const hit = store.get(key);

      if (hit && hit.expiresAt > now) return hit.promise;

      const promise = Promise.resolve().then(factory);

      store.set(key, { promise, expiresAt: now + ttlMs });

      try {
        return await promise;
      } catch (error) {
        store.delete(key);
        throw error;
      } finally {
        prune();
      }
    },

    clear() {
      store.clear();
    },
  };
}

module.exports = { createTtlCache };
