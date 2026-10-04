"use strict";

/**
 * FAQ read API for the storefront.
 *
 * NO NEW CMS MODEL, and no second FAQ implementation. This is a read contract
 * over the EXISTING `api::faq.faq` content type
 * (src/api/faq/content-types/faq/schema.json), which already owns everything
 * the homepage FAQ block needs: `question`, `answer` (blocks), `order` and
 * `active`.
 *
 * WHY A RESOLVER RATHER THAN THE SHADOW-CRUD `faqs` QUERY
 * ------------------------------------------------------
 * Two reasons, both the same class of bug the review resolver already fixes:
 *
 *  1. `answer` is a `blocks` field. Through shadow CRUD it arrives as a JSON
 *     node tree, so every consumer would have to walk it — and the storefront
 *     renders plain paragraphs. `src/utils/blocks.js` is the one conversion in
 *     this project; using it here means the FAQ answer reaches the client as
 *     text, exactly as a review comment does.
 *
 *  2. "Which FAQs are live" is `active === true` plus a published check plus an
 *     `order` sort with null-last semantics. Expressed as client-side filters
 *     that rule would be duplicated in every surface that renders FAQs, and the
 *     ordering of rows with no `order` value would differ between them.
 *
 * An entry with no question, or with no answer text, is dropped rather than
 * rendered as an empty accordion row: the homepage's FAQ structured data is
 * generated from what is actually rendered, so an empty row would become an
 * empty `acceptedAnswer` in Search Console.
 */

const { blocksToText } = require("../../utils/blocks");

const FAQ_UID = "api::faq.faq";

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

function clampLimit(value) {
  const parsed = Number.isInteger(value) ? value : DEFAULT_LIMIT;

  return Math.min(MAX_LIMIT, Math.max(1, parsed));
}

/**
 * `order:asc` at the DB level puts NULLs first in Postgres, which would float
 * every un-numbered FAQ above the curated ones. Re-sorted here so a missing
 * `order` means "after everything numbered", then stable by id.
 */
function compareFaqs(a, b) {
  return (
    (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
    String(a.documentId ?? "").localeCompare(String(b.documentId ?? ""))
  );
}

module.exports = ({ nexus, strapi }) => ({
  types: [
    nexus.objectType({
      name: "FaqEntry",
      definition(t) {
        t.nonNull.string("documentId");
        t.nonNull.string("question");
        /* Plain text, converted from the blocks field by utils/blocks.js.
           Newline-separated paragraphs; the client splits on "\n". */
        t.nonNull.string("answer");
        t.int("order");
      },
    }),

    nexus.extendType({
      type: "Query",
      definition(t) {
        t.nonNull.list.nonNull.field("faqEntries", {
          type: "FaqEntry",
          args: { limit: nexus.intArg({ default: DEFAULT_LIMIT }) },
          resolve: async (_parent, args) => {
            const limit = clampLimit(args.limit);

            try {
              const entries = await strapi.documents(FAQ_UID).findMany({
                filters: { active: { $eq: true } },
                status: "published",
                fields: ["documentId", "question", "answer", "order"],
                sort: ["order:asc"],
                limit: MAX_LIMIT,
              });

              return entries
                .map((entry) => {
                  const question = entry.question?.trim();
                  const answer = blocksToText(entry.answer);

                  if (!question || !answer) return null;

                  return {
                    documentId: entry.documentId,
                    question,
                    answer,
                    order: entry.order ?? null,
                  };
                })
                .filter(Boolean)
                .sort(compareFaqs)
                .slice(0, limit);
            } catch (error) {
              strapi.log.error(
                `[MOPET faqEntries] failed ${JSON.stringify({
                  message: error.message,
                })}`,
              );

              /* Rethrown, not swallowed: the homepage needs a real error state
                 for the FAQ block. Returning [] here would render "no
                 questions yet" for what is actually an outage, and would emit
                 no FAQPage structured data with no way to tell why. */
              throw error;
            }
          },
        });
      },
    }),
  ],

  resolversConfig: {
    "Query.faqEntries": { auth: false },
  },
});

module.exports.DEFAULT_LIMIT = DEFAULT_LIMIT;
module.exports.MAX_LIMIT = MAX_LIMIT;
module.exports.clampLimit = clampLimit;
module.exports.compareFaqs = compareFaqs;
