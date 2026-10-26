import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import { openInquiryStore } from '../src/inquiries/sqlite.js';
import { hashPassword } from '../src/admin/password.js';

export async function runReset({ args = [], env = {}, interactive = false, ask } = {}) {
  if (args.length || !interactive || typeof ask !== 'function' || !env.INQUIRY_DB_PATH) return false;
  let store;
  try {
    store = openInquiryStore(env.INQUIRY_DB_PATH, { requireExisting: true, allowMigration: false });
    if (!store.admin.hasAdmin()) return false;
    const first = await ask('New administrator passphrase (16–128 characters): ');
    const second = await ask('Confirm new passphrase: ');
    if (first !== second) return false;
    const credential = await hashPassword(first);
    store.admin.resetPassword(credential);
    return true;
  } catch { return false; }
  finally { store?.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let rl;
  let success = false;
  const controller = new AbortController();
  try {
    const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true && process.stderr.isTTY === true;
    if (interactive && process.argv.length === 2 && process.env.INQUIRY_DB_PATH) {
      // Same masked terminal/history policy as bootstrap; no password flags/env input.
      const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
      rl = createInterface({ input: process.stdin, output: muted, terminal: true, historySize: 0 });
      rl.on('SIGINT', () => { controller.abort(); rl.close(); });
      rl.on('close', () => controller.abort());
      success = await runReset({ env: process.env, interactive, ask: async prompt => {
        process.stderr.write(prompt);
        const password = await rl.question('', { signal: controller.signal });
        process.stderr.write('\n');
        return password;
      } });
    }
  } catch { /* Never print secrets, paths, hashes or exception details. */ }
  finally { rl?.close(); }
  console.log(success ? 'Local administrator passphrase reset; all sessions revoked.' : 'Reset unavailable. Use a private terminal and an existing configured demo administrator database.');
  process.exitCode = success ? 0 : 1;
}
