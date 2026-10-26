import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './src/http.js';
export { createServer } from './src/http.js';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const server = createServer();
    server.listen(process.env.PORT || 3000, () => console.log('Business assistant running'));
  } catch { console.error('Invalid assistant configuration. Check AI_PROVIDER, AI_MODEL, AI_API_KEY, GEMINI_API_KEY and AI_TIMEOUT_MS.'); process.exitCode = 1; }
}
