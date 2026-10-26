import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { geminiRequest } from '../src/gemini.js';
import { retrieveKnowledge } from '../src/knowledge.js';
import { INSTRUCTION, providerConfig } from '../src/provider.js';
import { parseFieldDetails, readBoundedBody, summary } from './lib/gemini-error-details.js';

// This module is not imported by the application. Defaults never contact Google.
// The injected transport is used only by synthetic tests; the CLI has no URL override.
export async function runDiagnostic({
  args = [], env = {}, input, fetchImpl = fetch, interactive = false,
  offlineTimeoutMs = 2000
} = {}) {
  if (args.length === 0) return summary(null, 'diagnostic_disabled');
  const offline = args.length === 3 && args[0] === '--offline' && args[1] === '--status' && /^[45]\d{2}$/.test(args[2]);
  const live = args.length === 1 && args[0] === '--live-once';
  if (!offline && !live) return summary(null, 'invalid_arguments');
  if (live && !interactive) return summary(null, 'local_terminal_required');
  let config;
  if (live) {
    try { config = providerConfig({ ...env, AI_PROVIDER: 'gemini' }); }
    catch { return summary(null, 'configuration_error'); }
  }
  let status = offline ? Number(args[2]) : null;
  const controller = new AbortController();
  let timer;
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => {
      resolve(summary(status, 'timeout'));
      controller.abort();
    }, live ? config.timeoutMs : offlineTimeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      let stream = input;
      if (live) {
        // Same instruction, parameters, model and scoped knowledge as the app.
        const request = geminiRequest(retrieveKnowledge('hotel'), 'What is check-in?', config, INSTRUCTION);
        const response = await fetchImpl(request.url, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: request.headers, body: JSON.stringify(request.body)
        });
        status = response.status;
        if (response.ok) {
          try { void response.body?.cancel().catch(() => {}); } catch { /* no logging */ }
          return summary(status, 'http_success'); // Never read or print a successful answer.
        }
        stream = response.body;
      }
      const bytes = await readBoundedBody(stream, controller.signal);
      return parseFieldDetails(status, bytes);
    })()]);
  } catch { return summary(status, 'network_error'); }
  finally { clearTimeout(timer); controller.abort(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Catch everything here so Node cannot print an exception containing provider data.
  let result;
  try {
    result = await runDiagnostic({
      args: process.argv.slice(2), env: process.env,
      input: process.argv[2] === '--offline' ? Readable.toWeb(process.stdin) : undefined,
      interactive: process.stdin.isTTY === true && process.stdout.isTTY === true && process.stderr.isTTY === true
    });
  } catch { result = summary(null, 'diagnostic_error'); }
  // Exactly one fixed-shape metadata record; no console/error/debug output.
  process.stdout.on('error', () => { process.exitCode = 1; });
  try { process.stdout.write(JSON.stringify(result) + '\n'); } catch { /* no logging */ }
  process.exitCode = ['diagnostic_disabled', 'http_success'].includes(result.category) ? 0 : 1;
}
