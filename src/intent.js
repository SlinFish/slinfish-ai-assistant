import { validText } from "./inquiries/validation.js";
import { selectLocalFact } from "./retrieval.js";

// Background is a positively reviewed speech act, never arbitrary text before
// the last question. These clauses describe interest, not verified availability.
const background = {
  hotel: /^(?:i'm|i am|we're|we are) (?:planning to stay at|thinking about a stay at|interested in staying at) (?:your|the) hotel(?: next week)?$/,
  realestate: /^(?:i'm|i am|we're|we are) (?:thinking about renting a home|interested in viewing a property)$/,
  auto: /^(?:i'm|i am|we're|we are) (?:looking into maintenance for (?:my|our) vehicle|researching repairs for (?:my|our) car)$/,
  retail: /^(?:i'm|i am|we're|we are) (?:looking for an item for (?:my|our) home|considering ordering from your store)$/,
};

// Question operators and their domain objects are interpreted separately from
// conversational wrappers. Every rule still consumes the whole request: a topic
// word alone cannot erase an unsupported modifier or a second question.
const requests = {
  hotel: {
    "check-in": [
      /^what time (?:i|we|guests) can check[ -]in$/,
      /^when check[ -]in (?:begins|starts)$/,
      /^what time check[ -]in (?:begins|starts)$/,
    ],
    booking: [
      /^how to (?:book|reserve) a room$/,
      /^(?:making|requesting) (?:a )?(?:room )?(?:reservation|booking)$/,
      /^what (?:information|details) (?:i|we) should (?:provide|share|send) for (?:a )?(?:room )?(?:booking|reservation) inquiry$/,
    ],
  },
  realestate: {
    property: [
      /^what (?:property |real estate )?services your agency (?:offers|provides|handles)$/,
      /^whether your agency handles (?:rentals|purchases|rentals or purchases|rentals and purchases)$/,
    ],
    viewing: [
      /^how to (?:arrange|request|schedule) a property (?:viewing|visit)$/,
      /^what (?:information|details) (?:i|we) should (?:provide|share|leave) for a (?:property )?viewing$/,
    ],
  },
  auto: {
    service: [
      /^what (?:automotive |maintenance )?services your workshop (?:offers|provides|handles)$/,
      /^whether (?:you|your workshop) (?:offer|offers|handle|handles) (?:maintenance|inspections|maintenance and inspections)$/,
    ],
    price: [
      /^how repair prices are determined$/,
      /^how (?:i|we) can (?:get|request) a repair (?:quote|estimate)$/,
    ],
  },
  retail: {
    stock: [
      /^how to (?:check|find out) whether an item is in stock$/,
      /^what (?:information|details) (?:i|we) should (?:provide|share|send) for a stock (?:check|inquiry)$/,
    ],
    delivery: [
      /^how (?:delivery|shipping) options are confirmed$/,
    ],
  },
};
const wrappers = [
  /^(?:can|could|would) you (?:please )?(?:tell me|explain|help me understand) (.+)$/,
  /^(?:i'd|i would|we'd|we would) like (?:some )?(?:information|details) about (.+)$/,
];

function interpretRequest(knowledge, clause) {
  // Require a wrapper before accepting polite comma syntax. This leaves the
  // reviewed fast-path grammar and its existing conservative behavior intact.
  const wrapper = wrappers.map((pattern) => pattern.exec(clause)).find(Boolean);
  const content = wrapper ? wrapper[1].replace(/,? please$/, "") : clause;
  const candidates = new Set();
  const direct = selectLocalFact(knowledge, content);
  if (direct.reason === "ambiguous") return null;
  if (direct.factId) candidates.add(direct.factId);
  for (const fact of knowledge.facts) {
    const patterns = requests[knowledge.businessId]?.[fact.id] ?? [];
    if (patterns.some((pattern) => pattern.test(content))) candidates.add(fact.id);
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function interpretLocalRequest(knowledge, message) {
  const uncovered = { factId: null, reason: "uncovered-intent" };
  if (!validText(message, 1000, true)) return uncovered;
  // Do not delete numbers, unknown symbols, contacts or non-English text.
  if (!/^[a-z\s'?,.!-]+$/i.test(message)) return uncovered;
  // Empty clauses must not make unsupported punctuation disappear.
  if (/[.!?]\s*[.!?]/.test(message)) return uncovered;
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  const clauses = [...normalized.matchAll(/([^.!?]+)([.!?]|$)/g)];
  if (!clauses.length || clauses.length > 6) return uncovered;
  let selected = null;
  for (const [, part, punctuation] of clauses) {
    // Only the greeting itself is consumed; all remaining words must be covered.
    const clause = part.trim().replace(/^(?:hi|hello|hey|good morning|good afternoon|good evening)(?:,\s*|$)/, "").trim();
    if (!clause) continue;
    if (background[knowledge.businessId]?.test(clause)) {
      if (punctuation === "?") return uncovered;
      continue;
    }
    const factId = interpretRequest(knowledge, clause);
    if (!factId || selected !== null) return uncovered;
    selected = factId;
  }
  return selected ? { factId: selected, reason: "interpreted" } : uncovered;
}
