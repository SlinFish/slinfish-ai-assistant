import http from "node:http";
import https from "node:https";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { businesses, answer, isBusiness } from "./src/businesses.js";
import {
  validateInquiry,
  validText,
  RequestError,
} from "./src/inquiries/validation.js";
import { openInquiryStore } from "./src/inquiries/sqlite.js";
import { createLimiter } from "./src/inquiries/rate-limit.js";
import {
  createAdminAuth,
  adminOrigin,
  sessionCookie,
  assertCsrf,
} from "./src/admin/auth.js";
export { businesses, answer } from "./src/businesses.js";
const publicDir = new URL("./public/", import.meta.url);
function reply(res, status, data, type = "application/json", headers = {}) {
  res.writeHead(status, {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    ...headers,
  });
  res.end(type === "application/json" ? JSON.stringify(data) : data);
}
async function body(req) {
  if (
    req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
      "application/json" ||
    (req.headers["content-encoding"] &&
      req.headers["content-encoding"] !== "identity")
  )
    throw new RequestError(415, "Use UTF-8 application/json");
  let size = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 12000) {
      req.resume();
      throw new RequestError(413, "Request too large");
    }
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    throw new RequestError(400, "Invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RequestError(400, "Invalid request");
  return value;
}
export function createServer({
  dbPath,
  now = Date.now,
  rateLimit,
  adminRateLimit,
  tlsOptions,
} = {}) {
  const limiter = createLimiter(rateLimit);
  const loginLimiter = createLimiter({
    limit: 5,
    windowMs: 15 * 60 * 1000,
    globalLimit: 20,
    ...adminRateLimit,
  });
  const store = dbPath === undefined ? null : openInquiryStore(dbPath);
  const auth = createAdminAuth(store?.admin, now);
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/admin/")) {
        const context = adminOrigin(
          req,
          server.address().port,
          req.method !== "GET",
        );
        if (req.method === "POST" && url.pathname === "/api/admin/login") {
          const retry = loginLimiter.attempt(req.socket.remoteAddress, now());
          if (retry)
            return reply(
              res,
              429,
              { error: "Too many login attempts" },
              "application/json",
              { "Retry-After": String(retry) },
            );
          const data = await body(req);
          if (
            Object.keys(data).length !== 1 ||
            !Object.hasOwn(data, "password")
          )
            throw new RequestError(400, "Invalid login request");
          const session = await auth.login(data.password, context.origin);
          return reply(
            res,
            200,
            { authenticated: true, csrfToken: session.csrfToken },
            "application/json",
            { "Set-Cookie": sessionCookie(session.token, context.secure) },
          );
        }
        if (req.method === "GET" && url.pathname === "/api/admin/session") {
          const session = auth.authenticate(
            req.headers.cookie,
            context.secure,
            context.origin,
          );
          res.setHeader("X-Admin-Session-Expires", String(auth.touch(session)));
          return reply(res, 200, {
            authenticated: true,
            csrfToken: session.csrfToken,
          });
        }
        if (req.method === "POST" && url.pathname === "/api/admin/logout") {
          const data = await body(req);
          if (Object.keys(data).length !== 0)
            throw new RequestError(400, "Invalid logout request");
          const session = auth.authenticate(
            req.headers.cookie,
            context.secure,
            context.origin,
          );
          auth.logout(session, req.headers["x-csrf-token"]);
          return reply(res, 200, { authenticated: false }, "application/json", {
            "Set-Cookie": sessionCookie("", context.secure, true),
          });
        }
        const match = url.pathname.match(
          /^\/api\/admin\/businesses\/([^/]+)\/inquiries\/([^/]+)(\/history)?$/,
        );
        if (
          (req.method === "GET" && url.pathname === "/api/admin/inquiries") ||
          match
        ) {
          if (
            req.method !== "GET" &&
            !(req.method === "PATCH" && match && !match[3])
          )
            throw new RequestError(405, "Method not allowed");
          // Read the bounded body before authorization so expiry/reset is rechecked afterwards.
          const data = req.method === "PATCH" ? await body(req) : undefined;
          const session = auth.authenticate(
            req.headers.cookie,
            context.secure,
            context.origin,
          );
          let result;
          if (req.method === "PATCH") {
            assertCsrf(session, req.headers["x-csrf-token"]);
            if (url.search)
              throw new RequestError(400, "Invalid status update");
            result = store.management.transition(
              match[1],
              match[2],
              data,
              session,
              context.origin,
              now(),
            );
          } else if (!match) result = store.management.list(url.searchParams);
          else if (match[3])
            result = store.management.history(
              match[1],
              match[2],
              url.searchParams,
            );
          else {
            if (url.search) throw new RequestError(400, "Invalid detail query");
            result = store.management.detail(match[1], match[2]);
          }
          res.setHeader("X-Admin-Session-Expires", String(auth.touch(session)));
          return reply(res, 200, result);
        }
        throw new RequestError(404, "Not found");
      }
      if (
        ["/admin", "/admin/login", "/admin.js", "/admin.css"].includes(
          url.pathname,
        )
      ) {
        const context = adminOrigin(req, server.address().port, false);
        if (req.method !== "GET")
          throw new RequestError(405, "Method not allowed");
        if (url.pathname === "/admin") {
          try {
            auth.authenticate(
              req.headers.cookie,
              context.secure,
              context.origin,
            );
          } catch (error) {
            if (error instanceof RequestError && error.status === 401)
              return reply(res, 303, "", "text/plain", {
                Location: "/admin/login",
              });
            throw error;
          }
        }
        const file =
          url.pathname === "/admin.js"
            ? "admin.js"
            : url.pathname === "/admin.css"
              ? "admin.css"
              : "admin.html";
        return reply(
          res,
          200,
          await readFile(new URL(file, publicDir)),
          file.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : file.endsWith(".css")
              ? "text/css; charset=utf-8"
              : "text/html; charset=utf-8",
          { "Referrer-Policy": "no-referrer" },
        );
      }
      if (req.method === "GET" && url.pathname === "/api/businesses")
        return reply(res, 200, businesses);
      if (
        req.method === "POST" &&
        ["/api/lead", "/api/chat"].includes(url.pathname)
      ) {
        if (req.headers.origin) {
          const port = server.address().port;
          const scheme = req.socket.encrypted ? "https" : "http";
          if (
            ![
              `${scheme}://localhost:${port}`,
              `${scheme}://127.0.0.1:${port}`,
            ].includes(req.headers.origin)
          )
            throw new RequestError(403, "Request origin not allowed");
        }
        if (url.pathname === "/api/lead") {
          const retry = limiter.attempt(req.socket.remoteAddress, now());
          if (retry)
            return reply(
              res,
              429,
              { error: "Too many inquiry attempts" },
              "application/json",
              { "Retry-After": String(retry) },
            );
        }
        const data = await body(req);
        if (url.pathname === "/api/chat") {
          if (
            !isBusiness(data.business) ||
            !validText(data.message, 1000, true) ||
            Object.keys(data).some(
              (key) => !["business", "message"].includes(key),
            )
          )
            throw new RequestError(400, "Invalid chat request");
          return reply(res, 200, {
            message: answer(businesses[data.business], data.message),
            mode: "rules-demo",
          });
        }
        const inquiry = validateInquiry(data);
        if (!store)
          return reply(res, 200, {
            stored: false,
            message:
              "Demo only: validated but not stored or sent. Local persistence is not configured.",
          });
        let id;
        try {
          id = store.save(inquiry, now());
        } catch {
          throw new RequestError(
            503,
            "Inquiry storage unavailable. Nothing was confirmed saved.",
          );
        }
        return reply(res, 201, {
          stored: true,
          inquiryId: id,
          message:
            "Fictional demo inquiry saved locally. No notification was sent.",
        });
      }
      if (url.pathname.startsWith("/api/"))
        throw new RequestError(404, "Not found");
      if (req.method !== "GET")
        throw new RequestError(405, "Method not allowed");
      const assets = {
        "/": ["index.html", "text/html; charset=utf-8"],
        "/app.js": ["app.js", "text/javascript; charset=utf-8"],
        "/style.css": ["style.css", "text/css; charset=utf-8"],
      };
      if (!Object.hasOwn(assets, url.pathname))
        throw new RequestError(404, "Not found");
      const [file, type] = assets[url.pathname];
      return reply(res, 200, await readFile(new URL(file, publicDir)), type);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) {
        const status = error instanceof RequestError ? error.status : 500;
        reply(
          res,
          status,
          {
            error:
              error instanceof RequestError ? error.message : "Request failed",
          },
          "application/json",
          { Connection: "close" },
        );
      }
    }
  };
  let server;
  try {
    server = tlsOptions
      ? https.createServer(tlsOptions, handler)
      : http.createServer(handler);
  } catch (error) {
    store?.close();
    throw error;
  }
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxRequestsPerSocket = 100;
  const cleanup = () => {
    limiter.clear();
    loginLimiter.clear();
    store?.close();
  };
  server.on("close", cleanup);
  server.on("error", cleanup);
  return server;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const port = Number(process.env.PORT ?? 3000);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("Invalid port");
    const server = createServer({ dbPath: process.env.INQUIRY_DB_PATH });
    server.on("error", () => {
      console.error(
        "Unable to start local demo. Check storage configuration and port.",
      );
      process.exitCode = 1;
    });
    server.listen(port, "127.0.0.1", () =>
      console.log(`Local demo listening on port ${server.address().port}`),
    );
    const stop = () => {
      server.close();
      server.closeAllConnections();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch {
    console.error(
      "Unable to start local demo. Check storage configuration and port.",
    );
    process.exitCode = 1;
  }
}
