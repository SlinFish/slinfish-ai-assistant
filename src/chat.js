import { retrieveKnowledge, demoSelection } from "./knowledge.js";
import { selectFact } from "./provider.js";
import { GEMINI_MODEL } from "./gemini.js";

export const HANDOFF =
  "I don't have verified information about that. Please contact a team member for help. This demo does not send inquiries to staff.";
export function createChat(config, fetchImpl) {
  // Snapshot only provider settings; this module never receives a store/session.
  const settings = Object.freeze({ ...config });
  if (!["demo", "gemini"].includes(settings.provider))
    throw new Error("Unsupported AI provider");
  if (
    settings.provider === "gemini" &&
    (typeof settings.apiKey !== "string" ||
      !settings.apiKey.trim() ||
      settings.model !== GEMINI_MODEL ||
      !Number.isInteger(settings.timeoutMs) ||
      settings.timeoutMs < 1 ||
      settings.timeoutMs > 30000)
  )
    throw new Error("Invalid Gemini configuration");
  return async (business, message) => {
    const knowledge = retrieveKnowledge(business);
    const mode = settings.provider;
    const handoff = { message: HANDOFF, handoff: true, mode, sources: [] };
    const approvedId = demoSelection(knowledge, message);
    if (!approvedId) return handoff;
    const approved = knowledge.facts.find((fact) => fact.id === approvedId);
    try {
      // Never forward raw input, contacts, records, credentials or chat history.
      // Gemini sees a static canonical alias, even when input casing varies.
      const id =
        mode === "demo"
          ? approvedId
          : await selectFact(
              knowledge,
              approved.questions[0],
              settings,
              fetchImpl,
            );
      if (id !== approvedId) return handoff;
      return {
        message: approved.text,
        handoff: false,
        mode,
        sources: [`${business}:${approved.id}`],
      };
    } catch {
      return { ...handoff, error: "assistant_unavailable" };
    }
  };
}
