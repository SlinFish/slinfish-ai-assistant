# SlinFish AI Business Assistant

A fictional business assistant with approved knowledge, optional server-side AI fact selection, and a deterministic demo mode. Preserves Northstar Properties, Harbor Auto Service, Luma Home Store, and Aster House. This is a prototype, **not production-ready**. It does not save or deliver inquiries, contact staff, or provide live listings, inventory, availability, or quotes.

## Run and test

Requires Node.js 20+ and npm. There are no third-party dependencies, installation step, or build step.

```sh
npm start
npm test
```

The default port is 3000. Demo mode needs no API key or paid API. Try “What is check-in?” for Hospitality or “What services do you offer?” for Automotive. Demo matches normalized, curated questions exactly; unfamiliar wording falls back to a team member. Handoff is an offer to contact staff, **not a delivered notification**.

## Server configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listening port supplied by hosting platform |
| `AI_PROVIDER` | `demo` | `demo` or `openai`; unsupported values fail startup |
| `AI_MODEL` | `gpt-4o-mini` | OpenAI model supporting Chat Completions, JSON object output, temperature and max_tokens |
| `AI_API_KEY` | unset | Required only for `openai`; backend only |
| `AI_TIMEOUT_MS` | `8000` | Whole provider operation deadline, integer 100–30000 ms |

Set variables in your hosting platform's secure environment settings. Never put credentials in frontend code, commits, chat, or a public configuration endpoint. `.env.example` lists non-secret defaults; Node does not load `.env` automatically. On Node 20.6+ you may explicitly run `node --env-file=.env server.js` with an ignored local file. Do not run `npm start` expecting it to load that file.

For AI mode, configure `AI_PROVIDER=openai`, `AI_API_KEY` through the host secret facility, and optionally `AI_MODEL`. The fixed provider destination is `https://api.openai.com/v1/chat/completions`; allow HTTPS egress to `api.openai.com`. Custom base URLs and browser-side provider calls are intentionally unsupported. Requests do not follow redirects. Provider authentication, billing access, model compatibility, network policy, and TLS trust require manual configuration. Do not disable TLS verification. Managed proxy credentials must be bound to `AI_API_KEY` for `api.openai.com` and used through the supplied proxy. Native fetch does not honor proxy variables by default on every supported Node version: in a managed proxy environment use Node.js 24.5+ with `NODE_USE_ENV_PROXY=1` (or `node --use-env-proxy server.js`), retaining the inherited proxy and CA trust settings. Earlier Node versions need a host-supported fetch proxy configuration before enabling AI mode. Direct deployment without a proxy can use Node.js 20+.

Live provider calls incur provider charges. They send the current question and only the selected business's approved knowledge to OpenAI. Avoid personal or sensitive information. No chat history is sent or retained by this application. Review provider retention and data-processing terms before enabling real traffic. This task adds no billing/subscription functionality.

## Architecture and knowledge approval

- `src/knowledge.js`: deeply frozen business details, service lists, FAQs, policy summaries, and retrieval restricted to one business. All claims derive from the original demo; empty service lists mean no additional service details are approved. Curated question variants add phrasing, not facts.
- `src/provider.js`: environment validation and OpenAI transport, bounded response size, abortable deadline, strict response shape. It asks for a fact ID or uncertainty, never free-form customer-facing text.
- `src/chat.js`: orchestration and output checks. Only IDs in the selected business's FAQs are accepted; answers are the exact approved text, with scoped source IDs. Unknown IDs, uncertainty and failures return a fixed handoff. No model-generated prose is displayed.
- `src/http.js`: routes, body limits, strict request validation, per-socket-IP rate limits, public asset allowlist, and safe errors. `server.js` is the startup entry point.
- `public/app.js`: text-only rendering and generation checks that discard replies from a previous business selection. API keys and provider configuration never reach the browser.
- `server.test.js` and `frontend.test.js`: deterministic knowledge, isolation, provider contract/failures/deadlines, HTTP behavior using ephemeral servers, and delayed frontend response isolation. Tests use simulated provider responses; they do not contact OpenAI or need credentials.

Review knowledge changes as code. Add only business-approved facts and question variants. To answer new topics, add approved FAQ text; details/services/policies provide context but are not independently rendered as answers. Unapproved prices, hours, services, policies, or inventory must remain unavailable. Automated tests and human review should accompany knowledge updates.

The AI integration is intentionally constrained retrieval and selection rather than an unrestricted generative chatbot. Exact approved output prevents fabricated text and foreign fact IDs, but a model can still select an irrelevant approved fact, misjudge uncertainty, or be manipulated into choosing the wrong fact. Prompt instructions and model confidence are not a proof of relevance. Evaluate adversarial questions, paraphrases, multi-part questions, and isolation before any real deployment. Demo mode prioritizes safe fallback over broad language coverage.

## HTTP API

`GET /api/businesses` returns public names and sectors only.

`POST /api/chat` requires JSON with exactly `business` (one of `realestate`, `auto`, `retail`, `hotel`) and `message` (nonblank string, maximum 1000 characters). Example:

```json
{"business":"hotel","message":"What is check-in?"}
```

A successful answer contains `message`, `mode` (`demo` or `openai`), `handoff`, and `sources` (e.g. `hotel:check-in`). Unknown questions return HTTP 200 with `handoff: true` and no sources. Provider failures return HTTP 503 with the same safe handoff plus `error: "assistant_unavailable"`; upstream bodies, credentials and exception details are suppressed. There are no automatic provider retries.

`POST /api/lead` remains a **validation-only demo**, requires a known business, a boolean `consent: true`, and nonblank strings `name` (100 characters), `contact` (150), `question` (400). It neither stores data nor sends it to a provider or staff. Use fictional test values only. No personal information persistence is implemented.

Both POST routes require `application/json`, limit bodies to 12000 bytes, and reject unexpected fields. Errors include 400 (invalid input), 413 (size), 415 (content type), 429 (rate limit, with `Retry-After`), and 503 (provider failure or limiter capacity). Unknown assets/routes are rejected.

## Deployment and security limitations

Deploy on a Node.js-capable host with start command `npm start` and its supplied `PORT`. Static-only hosting is insufficient for API routes. Start with demo mode, run `npm test`, then verify `/`, `/api/businesses`, and a chat request locally or through your deployed HTTPS endpoint. Configure secrets and egress before opting into AI mode. This repository does not include CI deployment or a paid-provider acceptance test.

The application stores no conversations, inquiries or customer personal information on disk and does not log request bodies. It temporarily processes request content in memory. Rate limits retain socket IP/count/expiry in memory only, clear expired records on subsequent POST requests, and clear on shutdown; the map is capped at 10000 clients. The limit is 30 POST attempts per IP per 60 seconds, shared across business IDs and API POST routes. It resets on process restart, is not distributed, and deliberately ignores `X-Forwarded-For`. Behind a reverse proxy, users may share a bucket. Deploy an edge limiter with trusted proxy configuration before public use.

HTTP header/request timeouts, response-size limits, no redirect following, public-file allowlisting, content-type checks, CSP, no-store responses, and textContent rendering provide basic protections. They do not replace an HTTPS reverse proxy with body upload deadlines, connection/concurrency limits, monitoring, abuse protection and global provider spend controls. The provider deadline limits upstream wait time, not all deployment resource usage. No authentication, tenant authorization, CSRF token system, durable audit trail, or production human handoff exists. Fictional business selection is public and is not a production tenant security boundary. Host/proxy logs and the AI provider may have their own retention policies. Obtain privacy and security review before real customer use.
