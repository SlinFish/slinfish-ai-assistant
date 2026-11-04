// Retain the AI branch's pinned model; availability is not checked at startup.
// Deliberately pin one Flash model. Never switch models or enable paid features.
export const GEMINI_MODEL = "gemini-3.8-flash";

export function geminiRequest(knowledge, message, config, instruction) {
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": config.apiKey,
    },
    body: {
      systemInstruction: {
        parts: [{ text: instruction }, { text: JSON.stringify(knowledge) }],
      },
      contents: [{ role: "user", parts: [{ text: message }] }],
      generationConfig: {
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingLevel: "MINIMAL" },
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          required: ["factId", "confident"],
          properties: {
            factId: {
              type: "STRING",
              nullable: true,
              enum: knowledge.facts.map((f) => f.id),
            },
            confident: { type: "BOOLEAN" },
          },
        },
      },
    },
  };
}

export function geminiSelectionText(response) {
  if (
    response.promptFeedback?.blockReason ||
    !Array.isArray(response.candidates) ||
    response.candidates.length !== 1
  )
    throw new Error("Invalid Gemini response");
  const candidate = response.candidates[0];
  if (
    candidate?.finishReason !== "STOP" ||
    candidate.safetyRatings?.some((rating) => rating.blocked)
  )
    throw new Error("Incomplete Gemini response");
  const parts = candidate.content?.parts;
  // Refuse truncated, blocked, thought, tool or multimodal output rather than guessing.
  if (
    !Array.isArray(parts) ||
    parts.length !== 1 ||
    typeof parts[0]?.text !== "string" ||
    Object.keys(parts[0]).some(
      (key) => !["text", "thoughtSignature"].includes(key),
    )
  )
    throw new Error("Invalid Gemini content");
  return parts[0].text;
}
