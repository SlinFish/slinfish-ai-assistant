import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import { openInquiryStore } from '../src/inquiries/sqlite.js';
import { hashPassword } from '../src/admin/password.js';

export async function runBootstrap({ args = [], env = {}, interactive = false, ask } = {}) {
  if (args.length || !interactive || typeof ask !== 'function' || !env.INQUIRY_DB_PATH) return false;
  let store;
  try {
    store = openInquiryStore(env.INQUIRY_DB_PATH);
    if (store.admin.hasAdmin()) return false;
    const first = await ask('New administrator passphrase (16–128 characters): ');
    const second = await ask('Confirm passphrase: ');
    if (first !== second) return false;
    const credential = await hashPassword(first);
    store.admin.createAdmin(credential); // Singleton primary key also rejects concurrent setup.
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
      // Readline sets raw mode; its terminal output goes to a muted sink.
      // No private readline overrides and no command-line/environment passwords.
      const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
      rl = createInterface({ input: process.stdin, output: muted, terminal: true, historySize: 0 });
      rl.on('SIGINT', () => { controller.abort(); rl.close(); });
      rl.on('close', () => controller.abort());
      success = await runBootstrap({ env: process.env, interactive, ask: async prompt => {
        process.stderr.write(prompt);
        const password = await rl.question('', { signal: controller.signal });
        process.stderr.write('\n');
        return password;
      } });
    }
  } catch { /* never print exceptions or credential material */ }
  finally { rl?.close(); }
  console.log(success ? 'Local administrator initialized.' : 'Setup unavailable or already completed. Use a private terminal and configured demo database.');
  process.exitCode = success ? 0 : 1;
}
