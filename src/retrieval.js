import { validText } from "./inquiries/validation.js";

// A small compositional grammar, not a similarity score or keyword search.
// A rule must consume the entire question. Unknown entities, modifiers, extra
// clauses and action requests are not discarded to manufacture a match.
const person = "(?:i|we)";
const how = `how (?:can|do|would|should) ${person}`;
const explain = "(?:can|could) you (?:please )?explain";
const tell = "(?:(?:can|could) you (?:please )?)?tell me";
const overview = [
  `what (?:(?:kinds|types) of )?{topic} (?:do|does) {actor} (?:offer|provide|handle)`,
  `what {topic} (?:are available|can ${person} ask {actor} about)`,
  `${tell} about {topic}`,
  `${explain} {topic}(?: {actor} (?:offer|offers|provide|provides))?`,
];
const details = [
  "what (?:details|information) (?:should|can) (?:i|we) (?:leave|provide|share|send) {purpose}",
  "what (?:details|information) (?:do you need|is needed) {purpose}",
  "what should (?:i|we) (?:leave|provide|share|send) {purpose}",
];
const process = [
  `${how} {request}`,
  `${tell} how to {request}`,
  `${explain} (?:the )?{topic}(?: (?:request|inquiry))? process`,
];

function rule(intents, synonyms, templates, coverage, exclusions) {
  // Slots contain reviewed grammar fragments only; never user-supplied regex.
  const patterns = templates.map((template) => {
    const expression = template.replace(/\{([a-z]+)\}/g, (_, slot) => {
      if (!Object.hasOwn(synonyms, slot))
        throw new Error("Unknown grammar slot");
      return `(?:${synonyms[slot]})`;
    });
    return new RegExp(`^(?:please )?(?:${expression})(?: please)?$`);
  });
  return {
    intents,
    synonyms,
    qualifiers: ["general information only"],
    coverage,
    exclusions,
    patterns,
  };
}

const viewing = "(?:(?:a|the|your) )?(?:property )?viewing";
const visit = "(?:(?:a|the) )?(?:property visit|visit to a property)";
const stock =
  "(?:(?:the|your|current|live) )?(?:stock|inventory|item availability|product availability)";
const delivery =
  "(?:(?:the|your) )?(?:available )?(?:delivery|shipping)(?: (?:options|choices))?";
const booking = "(?:(?:a|the) )?(?:room )?(?:booking|reservation)(?: inquiry)?";
const price =
  "(?:(?:the|a) )?(?:repair (?:price|prices|pricing|cost|costs|quote|quotes|estimate)|cost of (?:a repair|vehicle repairs))";

export const retrievalMetadata = {
  realestate: {
    property: rule(
      ["property-services"],
      {
        topic: "(?:(?:your|the) )?(?:(?:real estate|property) )?services",
        actor: "(?:you|your agency|your property agency)",
      },
      [
        ...overview,
        "what (?:kinds|types) of properties (?:do|does) {actor} handle",
        "(?:do you|can your agency) (?:help with|deal with|handle) (?:rentals|property purchases|rentals and purchases|renting or buying property)",
        "does your agency handle (?:rentals|property purchases)",
        "what does your (?:property )?agency do",
        "which types of property inquiries can you help with",
      ],
      [
        "rental inquiries",
        "purchase inquiries",
        "staff confirmation of current listings",
      ],
      [
        "specific property types",
        "live listings",
        "prices",
        "mortgage advice",
        "guaranteed approval",
      ],
    ),
    viewing: rule(
      ["viewing-request"],
      {
        topic: "(?:viewing|property viewing)",
        request: `(?:arrange|request|schedule|organize|ask for) (?:${viewing}|${visit})`,
        purpose: `(?:for|to (?:arrange|request|schedule)) (?:${viewing}|${visit})|when requesting (?:${viewing}|${visit})`,
      },
      [
        ...process,
        ...details,
        "i would like to view a property\\. what should i (?:provide|share|leave)",
      ],
      ["preferred area", "preferred viewing date", "staff confirmation"],
      [
        "confirmed appointments",
        "specific dates or times",
        "viewing fees",
        "cancellation policy",
      ],
    ),
  },
  auto: {
    service: rule(
      ["workshop-services"],
      {
        topic:
          "(?:(?:your|the) )?(?:(?:automotive|maintenance|vehicle) )?services",
        actor: "(?:you|your workshop|your auto workshop)",
      },
      [
        ...overview,
        "(?:do you|does your workshop) (?:handle|offer|perform) (?:vehicle )?(?:maintenance|inspections|maintenance and inspections)",
        "can your workshop help with (?:vehicle )?(?:maintenance|inspections)",
        "what does your (?:auto )?workshop do",
        "which services can i ask your workshop about",
      ],
      ["maintenance", "inspections", "staff confirmation of availability"],
      [
        "specific repair capabilities",
        "opening hours",
        "appointments",
        "warranties",
        "discounts",
      ],
    ),
    price: rule(
      ["repair-quote-process"],
      { topic: price },
      [
        "how much (?:do repairs|would a repair|does a repair) cost",
        "how are repair prices determined",
        `${explain} how repair quotes work`,
        `what (?:does {topic} depend on|determines {topic})`,
        `${how} (?:get|request|ask for) (?:a )?(?:repair quote|quote for repairs|repair estimate)`,
        `${tell} about {topic}`,
        "who can prepare (?:a )?repair quote",
        "can staff (?:give|prepare) (?:me )?(?:a )?repair (?:quote|estimate)",
        "how is (?:the )?cost of a repair worked out",
      ],
      ["vehicle and inspection determine price", "staff prepare quotes"],
      [
        "numeric prices",
        "fixed quotes",
        "free services",
        "quotes without inspection",
        "included parts",
      ],
    ),
  },
  retail: {
    stock: rule(
      ["stock-confirmation-process"],
      {
        topic: stock,
        purpose: `(?:for|to (?:check|verify|confirm)) (?:a )?(?:stock inquiry|stock check|stock)|to check (?:current )?stock`,
      },
      [
        ...details,
        `${how} (?:check whether an item is in stock|ask about product availability|find out about current inventory)`,
        `who can (?:confirm|verify) {topic}`,
        "can you tell me whether an item is (?:available|in stock)",
        "can staff (?:confirm|verify) whether an item is in stock",
        `${tell} how to check {topic}`,
      ],
      ["staff confirm live stock", "item and quantity needed"],
      [
        "specific products or quantities",
        "stock guarantees",
        "reservations",
        "order status",
      ],
    ),
    delivery: rule(
      ["delivery-options"],
      { topic: delivery },
      [
        "what {topic} are available",
        `${how} (?:find out about|ask about|check) {topic}`,
        "who can confirm {topic}",
        "what do {topic} depend on",
        "can staff (?:explain|confirm) {topic}",
        `${tell} about {topic}`,
        "does delivery depend on the destination",
        `${explain} how {topic} work`,
      ],
      ["options depend on destination", "staff confirm options"],
      [
        "fees",
        "specific destinations",
        "delivery dates",
        "tracking",
        "payment options",
      ],
    ),
  },
  hotel: {
    "check-in": rule(
      ["check-in-time"],
      { topic: "(?:the |your |guest )?check in(?: time)?" },
      [
        "when can (?:i|we|guests) (?:arrive to )?check in",
        "what time does check in (?:start|begin)",
        "when does check in (?:begin|start)",
        `${tell} (?:the )?check in time`,
        "at what time can (?:i|we|guests) check in",
        "what is (?:the |your )?(?:usual |sample )?check in time",
        `${tell} when check in (?:begins|starts)`,
        "when is {topic}",
        "what time can (?:i|we) arrive for check in",
        `${explain} (?:the )?check in time`,
      ],
      ["sample check-in begins at 2 PM", "confirm before travel"],
      [
        "early check-in",
        "late check-in",
        "specific arrival times",
        "guarantees",
        "check-out",
      ],
    ),
    booking: rule(
      ["room-booking-inquiry"],
      {
        topic: "(?:room )?(?:booking|reservation)",
        request: `(?:reserve a room|request a room|make (?:a )?room reservation inquiry|ask about ${booking}|request ${booking}|inquire about booking a room)`,
        purpose: `(?:for|to request) (?:${booking}|a room)`,
      },
      [
        ...process,
        ...details,
        "i would like to book a room\\. what should i (?:share|provide|send)",
      ],
      ["dates and guest count", "staff confirmation of availability and rates"],
      [
        "confirmed bookings",
        "specific dates or rates",
        "deposits",
        "cancellation policy",
        "amenities",
      ],
    ),
  },
};

// Freeze regexes as well as metadata; none have stateful g/y flags.
function freeze(value) {
  for (const item of Object.values(value))
    if (item && typeof item === "object") freeze(item);
  return Object.freeze(value);
}
freeze(retrievalMetadata);

export function selectLocalFact(knowledge, message) {
  const handoff = (reason) => ({ factId: null, reason });
  if (!validText(message, 1000, true)) return handoff("invalid-input");
  // Do not transliterate, strip unknown symbols or delete arbitrary words.
  if (!/^[a-z\s'?,.\-]+$/i.test(message)) return handoff("uncovered-input");
  const question = message
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[?.]$/, "")
    .trim();
  const matches = knowledge.facts.filter(
    (fact) =>
      fact.questions.some(
        (q) => q.toLowerCase().replace(/\?$/, "") === question,
      ) ||
      fact.retrieval.patterns.some((pattern) =>
        pattern.test(question.replace(/check-in/g, "check in")),
      ),
  );
  if (matches.length !== 1)
    return handoff(matches.length ? "ambiguous" : "uncovered-input");
  return { factId: matches[0].id, reason: "covered" };
}
