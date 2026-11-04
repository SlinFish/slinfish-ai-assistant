import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { validPassword, verifyPassword, dummyCredential } from "./password.js";
import { RequestError } from "../inquiries/validation.js";
export const IDLE_MS = 30 * 60 * 1000;
export const ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const tokenHash = (token) =>
  createHash("sha256").update(token).digest("hex");
const csrf = (token) =>
  createHmac("sha256", token)
    .update("slinfish-demo-csrf-v1")
    .digest("base64url");
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const cookieName = (secure) =>
  secure ? "__Host-slinfish-demo-admin" : "slinfish-demo-admin";
export function sessionCookie(token, secure, clear = false) {
  if (!clear && !tokenPattern.test(token))
    throw new Error("Invalid session cookie");
  return `${cookieName(secure)}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : ABSOLUTE_MS / 1000}${secure ? "; Secure" : ""}`;
}
export function readSessionCookie(header, secure) {
  if (typeof header !== "string") return undefined;
  const values = header
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.startsWith(cookieName(secure) + "="));
  if (values.length !== 1) return undefined;
  const value = values[0].slice(cookieName(secure).length + 1);
  return tokenPattern.test(value) ? value : undefined;
}
export function adminOrigin(req, port, mutation) {
  const secure = req.socket.encrypted === true;
  const peer = req.socket.remoteAddress;
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer))
    throw new RequestError(403, "Administrator request not allowed");
  const hosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
  if (port === (secure ? 443 : 80))
    hosts.push("localhost", "127.0.0.1", "[::1]");
  const host = req.headers.host;
  const hostCount = req.rawHeaders.filter(
    (_, index) =>
      index % 2 === 0 && req.rawHeaders[index].toLowerCase() === "host",
  ).length;
  if (
    typeof host !== "string" ||
    hostCount !== 1 ||
    !hosts.includes(host.toLowerCase())
  )
    throw new RequestError(403, "Administrator request not allowed");
  const origin = new URL(`${secure ? "https" : "http"}://${host}`).origin;
  if (
    (mutation || req.headers.origin !== undefined) &&
    req.headers.origin !== origin
  )
    throw new RequestError(403, "Administrator request not allowed");
  if (req.headers["sec-fetch-site"] === "cross-site")
    throw new RequestError(403, "Administrator request not allowed");
  return { origin, secure };
}
export function assertCsrf(session, suppliedCsrf) {
  if (
    typeof suppliedCsrf !== "string" ||
    !tokenPattern.test(suppliedCsrf) ||
    !timingSafeEqual(Buffer.from(suppliedCsrf), Buffer.from(session.csrfToken))
  )
    throw new RequestError(403, "Administrator request not allowed");
}
export function createAdminAuth(repository, now = Date.now) {
  const dummy = dummyCredential();
  let verifying = false;
  return {
    async login(password, origin) {
      if (!validPassword(password))
        throw new RequestError(400, "Invalid login request");
      if (verifying) throw new RequestError(429, "Too many login attempts");
      verifying = true;
      try {
        const admin = repository?.getAdmin();
        const matches = await verifyPassword(password, admin ?? dummy);
        if (!admin || admin.enabled !== 1 || !matches)
          throw new RequestError(401, "Invalid administrator credentials");
        const token = randomBytes(32).toString("base64url");
        if (
          !repository.createSession(
            tokenHash(token),
            origin,
            now(),
            IDLE_MS,
            ABSOLUTE_MS,
            admin,
          )
        )
          throw new RequestError(401, "Invalid administrator credentials");
        return { token, csrfToken: csrf(token) };
      } finally {
        verifying = false;
      }
    },
    authenticate(header, secure, origin) {
      const token = readSessionCookie(header, secure);
      const row = token
        ? repository?.session(tokenHash(token), origin, now())
        : undefined;
      if (!row) throw new RequestError(401, "Authentication required");
      return {
        hash: tokenHash(token),
        csrfToken: csrf(token),
        absoluteExpiresAt: row.absolute_expires_at,
      };
    },
    touch(session) {
      const time = now();
      repository.touch(session.hash, time, IDLE_MS);
      return Math.min(time + IDLE_MS, session.absoluteExpiresAt);
    },
    logout(session, suppliedCsrf) {
      assertCsrf(session, suppliedCsrf);
      repository.revoke(session.hash, now());
    },
  };
}
