// Only fixed categories and numeric metadata may cross the local logging boundary.
// Never serialize Error objects, provider bodies, request data or configuration.
const categories = new Set(['http_error', 'request_rejected', 'authentication_error', 'model_access_error', 'quota_error', 'network_error', 'timeout', 'invalid_response', 'configuration_error']);
const phases = new Set(['request', 'response_body', 'response_validation']);
export class ProviderFailure extends Error {
  constructor(category) {
    super(category === 'timeout' ? 'Provider timeout' : 'Provider operation failed');
    this.category = categories.has(category) ? category : 'invalid_response';
  }
}
export function httpFailure(status) {
  if (status === 429) return new ProviderFailure('quota_error');
  if (status === 401) return new ProviderFailure('authentication_error');
  if (status === 403 || status === 404) return new ProviderFailure('model_access_error');
  if (status === 400 || status === 422) return new ProviderFailure('request_rejected');
  return new ProviderFailure('http_error');
}
export function reportFailure(config, error, { phase, status, elapsedMs, timedOut }) {
  if (config.diagnostics !== true) return;
  const category = timedOut ? 'timeout'
    : error instanceof ProviderFailure && categories.has(error.category) ? error.category
      : phase === 'response_validation' ? 'invalid_response' : 'network_error';
  const record = {
    event: 'ai_provider_failure',
    provider: ['gemini', 'openai'].includes(config.provider) ? config.provider : 'unknown',
    category,
    phase: phases.has(phase) ? phase : 'request',
    httpStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    elapsedMs: Number.isFinite(elapsedMs) ? Math.min(86400000, Math.max(0, Math.floor(elapsedMs))) : 0
  };
  // Logging failures must never affect customer behavior. No raw exception logging.
  try { console.error(JSON.stringify(record)); } catch { /* local sink unavailable */ }
}
