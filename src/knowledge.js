import { businesses as configuredBusinesses } from "./businesses.js";
import { retrievalMetadata } from "./retrieval.js";
import { createHash } from "node:crypto";

// Approved aliases from the grounded-AI branch. Claims remain sourced from the
// lead-management business configurations, which retain their public API shape.
const questions = {
  realestate: {
    property: [
      "property",
      "What properties do you handle?",
      "What services do you offer?",
    ],
    viewing: ["viewing", "How do I arrange a viewing?"],
  },
  auto: {
    service: ["service", "What services do you offer?"],
    price: ["price", "How much do repairs cost?"],
  },
  retail: {
    stock: ["stock", "Is this item in stock?"],
    delivery: ["delivery", "What are the delivery options?"],
  },
  hotel: {
    "check-in": [
      "check-in",
      "What is check-in?",
      "When can I check in?",
      "What time is check-in?",
    ],
    booking: ["booking", "How do I book a room?"],
  },
};
function freeze(value) {
  Object.values(value).forEach((v) => {
    if (v && typeof v === "object") freeze(v);
  });
  return Object.freeze(value);
}
export const businesses = freeze(
  Object.fromEntries(
    Object.entries(configuredBusinesses).map(([id, business]) => [
      id,
      {
        name: business.name,
        sector: business.sector,
        details: { fictional: true },
        faqs: business.faq.map(([factId, text]) => ({
          id: factId,
          text,
          questions: questions[id][factId],
        })),
      },
    ]),
  ),
);
export function retrieveKnowledge(id) {
  if (typeof id !== "string" || !Object.hasOwn(businesses, id))
    throw new Error("Unknown business");
  const business = businesses[id];
  return {
    name: business.name,
    sector: business.sector,
    details: business.details,
    facts: business.faqs,
  };
}
// Local-only interpretation metadata is never part of provider knowledge or the
// public businesses response. All claims still use the original FAQ text.
const localKnowledge = freeze(
  Object.fromEntries(
    Object.entries(businesses).map(([id, business]) => [
      id,
      {
        businessId: id,
        facts: business.faqs.map((fact) => ({
          ...fact,
          scopedId: `${id}:${fact.id}`,
          retrieval: retrievalMetadata[id][fact.id],
        })),
      },
    ]),
  ),
);
export function retrieveLocalKnowledge(id) {
  if (typeof id !== "string" || !Object.hasOwn(localKnowledge, id))
    throw new Error("Unknown business");
  return localKnowledge[id];
}
// Keep Unicode and digits: deleting them could turn private free-form input into
// an apparently approved question. Only case, whitespace and final ? vary.
export const normalize = (text) =>
  text.trim().toLowerCase().replace(/\s+/gu, " ").replace(/\?$/, "").trim();
export function demoSelection(knowledge, message) {
  return (
    knowledge.facts.find((fact) =>
      fact.questions.some((q) => normalize(q) === normalize(message)),
    )?.id ?? null
  );
}

// Contextual turns are deliberately an exact, business-scoped allowlist.
// No free-form keyword or similarity matching is permitted.
const followups = freeze({
  hotel: {
    booking: {
      type: "booking-information",
      questions: [
        "What information do you need from me?",
        "What details should I provide?",
        "What do you need from me?",
        "And what information is required?",
      ],
      transitions: {
        "What about check-in?": "check-in",
      },
    },
  },
  auto: {
    service: {
      type: "service-information",
      questions: [],
      transitions: { "What about the cost?": "price" },
    },
  },
  retail: {
    stock: {
      type: "stock-information",
      questions: [],
      transitions: { "And delivery?": "delivery" },
    },
  },
  realestate: {
    viewing: {
      type: "viewing-information",
      questions: ["How do I arrange that?"],
      transitions: {},
    },
  },
});
export const knowledgeRevision = createHash("sha256").update(JSON.stringify({ businesses, followups })).digest("hex");
export function topicFor(business, factId) {
  return Object.hasOwn(followups, business) && Object.hasOwn(followups[business], factId)
    ? followups[business][factId].type : null;
}
export function resolveFollowup(business, message, topic) {
  if (!topic || topic.businessId !== business || topic.knowledgeRevision !== knowledgeRevision) return null;
  if (topicFor(business, topic.factId) !== topic.followupType || !topic.followupType) return null;
  const policy = followups[business][topic.factId];
  if (policy.questions.some(question => normalize(question) === normalize(message))) return topic.factId;
  const transition = Object.entries(policy.transitions).find(([question]) => normalize(question) === normalize(message));
  return transition?.[1] ?? null;
}
