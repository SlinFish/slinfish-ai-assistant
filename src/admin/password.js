import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
export const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
export function validPassword(value, setup = false) {
  return typeof value === 'string' && value.isWellFormed() && value.length >= (setup ? 16 : 1) && value.length <= 128
    && value.trim().length >= (setup ? 16 : 1) && !/[\u0000-\u001f\u007f]/.test(value);
}
function derive(password, salt) {
  const input = Buffer.from(password, 'utf8');
  return new Promise((resolve, reject) => {
    scrypt(input, salt, 64, SCRYPT, (error, key) => { input.fill(0); if (error) reject(new Error('Password operation failed')); else resolve(key); });
  });
}
export async function hashPassword(password) {
  if (!validPassword(password, true)) throw new Error('Invalid passphrase');
  const salt = randomBytes(16).toString('hex'), key = await derive(password, salt);
  try { return { password_salt: salt, password_hash: key.toString('hex'), scrypt_n: SCRYPT.N, scrypt_r: SCRYPT.r, scrypt_p: SCRYPT.p }; }
  finally { key.fill(0); }
}
export const dummyCredential = () => ({ password_salt: randomBytes(16).toString('hex'), password_hash: randomBytes(64).toString('hex'), scrypt_n: SCRYPT.N, scrypt_r: SCRYPT.r, scrypt_p: SCRYPT.p });
export async function verifyPassword(password, record) {
  if (!validPassword(password) || !/^[0-9a-f]{32}$/.test(record.password_salt) || !/^[0-9a-f]{128}$/.test(record.password_hash)
    || record.scrypt_n !== SCRYPT.N || record.scrypt_r !== SCRYPT.r || record.scrypt_p !== SCRYPT.p) return false;
  const key = await derive(password, record.password_salt), expected = Buffer.from(record.password_hash, 'hex');
  try { return timingSafeEqual(key, expected); } finally { key.fill(0); expected.fill(0); }
}
