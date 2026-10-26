export const ERROR_BODY_LIMIT = 32768;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const statusNumber = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
export const summary = (httpStatus, category, fieldGroups = []) => ({ httpStatus: statusNumber(httpStatus), category, fieldGroups });

// Match only known request roots and syntactic descendants. Return constants,
// never the provider's field string (which can contain customer or secret data).
const suffix = '(?:\\.[A-Za-z_][A-Za-z0-9_]*|\\[\\d{1,3}\\])*';
const groups = [
  ['thinking_config', '(?:generationConfig\\.thinkingConfig|generation_config\\.thinking_config)'],
  ['response_schema', '(?:generationConfig\\.responseSchema|generation_config\\.response_schema)'],
  ['response_mime_type', '(?:generationConfig\\.responseMimeType|generation_config\\.response_mime_type)'],
  ['max_output_tokens', '(?:generationConfig\\.maxOutputTokens|generation_config\\.max_output_tokens)'],
  ['system_instruction', '(?:systemInstruction|system_instruction)'],
  ['contents', 'contents']
].map(([name, path]) => [name, new RegExp('^' + path + suffix + '$')]);

export function parseFieldDetails(httpStatus, bytes) {
  const empty = () => summary(httpStatus, 'no_safe_field_details');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > ERROR_BODY_LIMIT) return empty();
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!record(body) || !record(body.error) || !Array.isArray(body.error.details)) return empty();
    const found = new Set();
    for (const detail of body.error.details.slice(0, 16)) {
      if (!record(detail) || detail['@type'] !== 'type.googleapis.com/google.rpc.BadRequest') continue;
      const violations = detail.fieldViolations ?? detail.field_violations;
      if (!Array.isArray(violations)) continue;
      for (const violation of violations.slice(0, 32)) {
        if (!record(violation) || typeof violation.field !== 'string' || violation.field.length > 512 || /[\s\u0000-\u001f\u007f]/.test(violation.field)) continue;
        const match = groups.find(([, pattern]) => pattern.test(violation.field));
        if (match) found.add(match[0]);
      }
    }
    return found.size ? summary(httpStatus, 'field_violations', [...found].sort()) : empty();
  } catch { return empty(); } // JSON/UTF-8 exceptions can include raw text. Never emit them.
}

export async function readBoundedBody(stream, signal) {
  if (!stream) return null;
  const reader = stream.getReader();
  const cancel = () => { try { void reader.cancel().catch(() => {}); } catch { /* no logging */ } };
  signal.addEventListener('abort', cancel, { once: true });
  const bytes = new Uint8Array(ERROR_BODY_LIMIT);
  let size = 0;
  try {
    if (signal.aborted) return null;
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        return bytes.subarray(0, size);
      }
      if (!(value instanceof Uint8Array) || value.byteLength > ERROR_BODY_LIMIT - size) return null;
      // Copy only accepted bytes; never retain an oversized backing buffer.
      bytes.set(value, size);
      size += value.byteLength;
    }
    return null;
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel(); // Never wait for untrusted cleanup to finish.
  }
}
