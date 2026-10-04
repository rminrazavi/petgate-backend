"use strict";

/**
 * Strapi `blocks` <-> plain text.
 *
 * TWO REAL BUGS THIS FIXES
 * ------------------------
 * 1. `Review.comment` is a `blocks` field (review/content-types/review/
 *    schema.json), but `POST /api/reviews` passes the customer's raw string
 *    straight into `documents().create({ data: { comment } })`. A blocks
 *    field expects an array of nodes, so the submitted comment was never a
 *    valid document.
 * 2. The `productReviews` GraphQL resolver declares `comment` as a
 *    `String`, so a blocks array was coerced with `String(value)` — the
 *    storefront's `typeof review.comment === "string"` check then hid every
 *    comment it did receive.
 *
 * Both directions live here so there is one conversion, not one per caller.
 */

/** Reads the text out of a blocks tree (paragraphs, lists, headings, quotes). */
function blocksToText(blocks) {
  if (blocks == null) return null;

  if (typeof blocks === "string") {
    const trimmed = blocks.trim();

    return trimmed.length > 0 ? trimmed : null;
  }

  /* Strapi 5 normally returns Blocks as the array itself. Some Document
     Service/REST adapters, however, expose JSON-valued Blocks through a thin
     wrapper (`{ blocks: [...] }` or `{ data: [...] }`). Normalize that wire
     shape at the shared boundary so FAQ answers are not silently treated as
     empty just because the transport chose the wrapper form. The content still
     has to be real Blocks nodes; no text is invented here. */
  if (!Array.isArray(blocks)) {
    if (Array.isArray(blocks.blocks)) return blocksToText(blocks.blocks);
    if (Array.isArray(blocks.data)) return blocksToText(blocks.data);
    return null;
  }

  const lines = [];

  const walk = (node) => {
    if (node == null) return "";

    if (typeof node === "string") return node;

    if (Array.isArray(node)) return node.map(walk).join("");

    if (typeof node.text === "string") return node.text;

    if (Array.isArray(node.children)) return node.children.map(walk).join("");

    return "";
  };

  for (const block of blocks) {
    if (block?.type === "list" && Array.isArray(block.children)) {
      for (const item of block.children) {
        const text = walk(item).trim();

        if (text) lines.push(text);
      }

      continue;
    }

    const text = walk(block).trim();

    if (text) lines.push(text);
  }

  const joined = lines.join("\n").trim();

  return joined.length > 0 ? joined : null;
}

/**
 * Turns a plain-text submission into the minimal valid blocks document
 * (one paragraph per non-empty line). Returns `null` for empty input so a
 * comment-less review stays comment-less instead of storing an empty node.
 */
function textToBlocks(text) {
  if (typeof text !== "string") {
    return Array.isArray(text) ? text : null;
  }

  const paragraphs = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return null;

  return paragraphs.map((line) => ({
    type: "paragraph",
    children: [{ type: "text", text: line }],
  }));
}

module.exports = { blocksToText, textToBlocks };
