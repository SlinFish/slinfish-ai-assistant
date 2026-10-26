import { businesses, retrieveKnowledge, demoSelection, normalize } from './knowledge.js';
import { selectFact } from './provider.js';
export const HANDOFF = "I don't have verified information about that. Please contact a team member for help. This demo does not send inquiries to staff.";
export function createChat(config, fetchImpl) {
  return async (business, message) => {
    const knowledge = retrieveKnowledge(business);
    const mode = config.provider;
    // Reject explicit references to other configured businesses before provider use.
    const question = normalize(message);
    if (Object.entries(businesses).some(([id, b]) => id !== business && question.includes(normalize(b.name)))) {
      return { message: HANDOFF, handoff: true, mode, sources: [] };
    }
    try {
      const id = mode === 'demo' ? demoSelection(knowledge, message) : await selectFact(knowledge, message, config, fetchImpl);
      const fact = knowledge.facts.find(f => f.id === id);
      if (!fact) return { message: HANDOFF, handoff: true, mode, sources: [] };
      return { message: fact.text, handoff: false, mode, sources: [`${business}:${fact.id}`] };
    } catch {
      return { message: HANDOFF, handoff: true, mode, sources: [], error: 'assistant_unavailable' };
    }
  };
}
