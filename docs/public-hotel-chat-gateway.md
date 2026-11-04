# Public Aster House chat gateway — H-3 staging

This is a **separate process** from `server.js`. It exposes ONLY `GET /health` and `POST /v1/hotel/chat`. It deliberately does not load SQLite, administrator authentication, inquiry storage, `/admin`, or the multi-business UI. All chat requests are forced to fictional `hotel` facts, use `AI_PROVIDER=demo` semantics and share the existing vetted conversation rules. It cannot make bookings or notify staff.

## Deployment plan (do NOT deploy before validation)

Use a separate Node.js 24 web service (for example Render, with a free tier only if actually offered and sufficient), rooted at this repository. The start command is `npm run start:hotel-chat`. Set a **new random 32–256 character secret** in the server's `PUBLIC_CHAT_BRIDGE_TOKEN`; do not put it in Git or the browser. The host provides `PORT`. Only the gateway listens on `0.0.0.0` in this mode; the existing local `npm start` continues binding localhost and remains unchanged. Health endpoint is safe but contains no sensitive data.

The separate Hotel Demo Cloudflare Pages Function must use the **same secret** as a private `PUBLIC_CHAT_BRIDGE_TOKEN` environment binding and set `PUBLIC_HOTEL_CHAT_UPSTREAM` to the exact HTTPS **origin** (no trailing slash, paths or query). Function requests are same-origin; it never returns the bridge token to the browser. In Cloudflare Pages build environment set `PUBLIC_HOTEL_CHAT_ENABLED=1` **only after** the remote gateway is verified, then rebuild. Without that explicit build flag, the Hotel Demo stays offline preview. A static export on a public branch must be built using `npm run build:demo`, not `npm run build`.

## Security and limits

- Shared high-entropy bridge secret is checked using timing-safe equality. It authenticates the Pages-to-gateway hop, not the website visitor.
- HTTPS terminates at the hosting provider. Never send this token over plaintext internet.
- Body ≤12000 bytes, questions ≤1000 UTF-16 units, strict one-field JSON; no arbitrary business selection, inquiry writes or admin API.
- Existing in-memory rate limiter: 20 per client IP, 100 per instance/minute, plus bounded conversation metadata (3-minute idle; 10-minute absolute; six turns).
- In-memory client-IP limits are **not global across instances**. Host behind Cloudflare edge abuse protection for actual public traffic, and monitor usage. Denial-of-service protections and secure deployment checks are still required.
- No chat logs or guest identifiers should be stored. The client IP is used for temporary rate limiting only.
- No Gemini calls are made from this process, even if `GEMINI_API_KEY` is set elsewhere.

## Windows verification

From the AI Assistant repository on this branch:

```powershell
node --version
node --check public-hotel-chat.js
node --test test/public-hotel-chat.test.js
npm test
```

Do not publish the gateway unless all checks pass. Confirm that `/api/admin/inquiries` and `/api/lead` return 404 on the public gateway. No secret or host has yet been provisioned, and no production deployment is claimed.
