"use strict";

/**
 * Normalizes a relation value out of a lifecycle payload.
 *
 * WHY THIS EXISTS (root cause of "Undefined attribute level operator id"):
 *
 * Different callers hand Strapi completely different shapes for the
 * same relation field:
 *
 *   Document Service / seeders   "abc123documentid"   (documentId string)
 *   REST content-api             { connect: ["abc123documentid"] }
 *   Admin panel relation picker  { connect: [{ id: 12, position: {...} }],
 *                                  disconnect: [] }        <-- numeric id
 *   Query engine / legacy        12                          (numeric id)
 *
 * Lifecycles that assumed the documentId shape ended up passing an
 * object (or a numeric id) straight into
 * `strapi.documents(uid).findOne({ documentId: <that value> })`, which
 * makes the Document Service try to interpret `{ id: 12, position: … }`
 * as a filter on the documentId attribute and throw
 * "Undefined attribute level operator id".
 *
 * This helper resolves any of those shapes to a documentId, translating
 * numeric primary keys through the query engine when needed.
 */

function firstEntry(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Extracts the raw relation reference (before documentId resolution).
 * Returns null when the payload expresses "no relation".
 */
function extractRelationRef(raw) {
  if (raw === null || raw === undefined || raw === "") return null;

  if (typeof raw === "string" || typeof raw === "number") return raw;

  if (Array.isArray(raw)) {
    const entry = firstEntry(raw);
    return entry === undefined ? null : extractRelationRef(entry);
  }

  if (typeof raw === "object") {
    // Admin panel / REST relational payloads.
    if (Array.isArray(raw.connect) && raw.connect.length > 0) {
      return extractRelationRef(raw.connect[0]);
    }

    if (Array.isArray(raw.set) && raw.set.length > 0) {
      return extractRelationRef(raw.set[0]);
    }

    // An explicit empty connect/set means "cleared", not "unchanged".
    if (Array.isArray(raw.connect) || Array.isArray(raw.set)) return null;

    if (raw.documentId) return raw.documentId;
    if (raw.id !== undefined && raw.id !== null) return raw.id;
  }

  return null;
}

/** True when the payload sets the relation to something. */
function hasRelation(raw) {
  return extractRelationRef(raw) !== null;
}

/**
 * Resolves any relation payload shape to a documentId string.
 * Numeric/primary-key references are translated through the query
 * engine, which is the only place that mapping exists.
 */
async function resolveRelationDocumentId(strapi, uid, raw) {
  const ref = extractRelationRef(raw);

  if (ref === null) return null;

  if (typeof ref === "string" && !/^\d+$/.test(ref)) return ref;

  const row = await strapi.db.query(uid).findOne({
    where: { id: Number(ref) },
    select: ["documentId"],
  });

  return row?.documentId ?? null;
}

module.exports = {
  extractRelationRef,
  hasRelation,
  resolveRelationDocumentId,
};
