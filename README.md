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
| `AI_PROVIDER` | `demo` | `demo`, `gemini`, or `openai`; unsupported values fail startup |
| `AI_MODEL` | provider-specific | Gemini: `gemini-3.8-flash` (only supported Gemini ID); OpenAI: `gpt-4o-mini` |
| `GEMINI_API_KEY` | unset | Required only for `gemini`; backend only, sent in `x-goog-api-key` header |
| `AI_API_KEY` | unset | Required only for `openai`; backend only |
| `AI_TIMEOUT_MS` | `8000` | Whole provider operation deadline, integer 100–30000 ms |
| `AI_DIAGNOSTICS` | disabled | Only exact `1` enables safe failure metadata on local server stderr |

Set variables in your hosting platform's secure environment settings. Never put credentials in frontend code, commits, chat, or a public configuration endpoint. `.env.example` lists non-secret defaults; Node does not load `.env` automatically. On Node 20.6+ you may explicitly run `node --env-file=.env server.js` with an ignored local file. Do not run `npm start` expecting it to load that file.

For optional **OpenAI** mode (outside the $0 workflow), configure `AI_PROVIDER=openai`, `AI_API_KEY` through the host secret facility, and optionally `AI_MODEL`. The fixed provider destination is `https://api.openai.com/v1/chat/completions`; allow HTTPS egress to `api.openai.com`. Custom base URLs and browser-side provider calls are intentionally unsupported. Requests do not follow redirects. OpenAI authentication, model compatibility, network policy, and TLS trust require manual configuration. Do not enable OpenAI for the $0 workflow. Do not disable TLS verification. Managed proxy credentials must be bound to `AI_API_KEY` for `api.openai.com` and used through the supplied proxy. Native fetch does not honor proxy variables by default on every supported Node version: in a managed proxy environment use Node.js 24.5+ with `NODE_USE_ENV_PROXY=1` (or `node --use-env-proxy server.js`), retaining the inherited proxy and CA trust settings. Earlier Node versions need a host-supported fetch proxy configuration before enabling AI mode. Direct deployment without a proxy can use Node.js 20+.

OpenAI calls can incur charges; Gemini Free tier has limited unpaid quotas for eligible unbilled projects. Live mode sends the current question and only the selected business's approved knowledge to the explicitly selected provider (Google or OpenAI). Avoid personal or sensitive information. No chat history is sent or retained by this application. Review provider retention and data-processing terms before enabling real traffic. This task adds no billing/subscription functionality.

## Gemini and the $0 workflow

Demo mode remains the default, even if API keys are present. Run locally with Node.js on your existing machine; no paid hosting, subscription, or billing activation is required. OpenAI is optional and must not be enabled for this budget.

1. In [Google AI Studio](https://aistudio.google.com/apikey), select your existing **unbilled Free tier project** and create/reuse a Gemini API key. Confirm its tier and model availability in AI Studio. Do **not** attach a billing account or upgrade to obtain quota. If the model is unavailable for that project, region or account, keep demo mode.
2. Store `GEMINI_API_KEY` only in the server's secure environment settings or an ignored local `.env` file. Never paste it into browser code, API requests to this app, or commits.
3. Configure these non-secret values, then run `npm start` (or `node --env-file=.env server.js` to load a local ignored file):

   ```dotenv
   AI_PROVIDER=gemini
   AI_MODEL=gemini-3.8-flash
   AI_TIMEOUT_MS=8000
   ```

   Remove a previous OpenAI `AI_MODEL` value before switching. The selected model defaults automatically if `AI_MODEL` is unset. Other Gemini IDs fail startup rather than silently using an unverified or paid model. Presence of `AI_API_KEY` never causes a Gemini request to use OpenAI.
4. Permit HTTPS egress to `generativelanguage.googleapis.com`. Requests use Google's official `v1beta/models/gemini-3.8-flash:generateContent` REST API; the key goes in a header, never the URL. Managed secret-proxy bindings must use `GEMINI_API_KEY` and that destination. Apply the native-fetch proxy/CA configuration described above if needed.
5. Test with fictional questions only. Inspect your project's active quotas in AI Studio. A 429/quota error, denied access, unavailable model, safety block, timeout, malformed response, or network failure returns the safe handoff (HTTP 503). There are **no retries, model substitutions, or fallback providers**. Unknown or uncertain selections return normal HTTP 200 handoff. Manually choose `AI_PROVIDER=demo` to continue without remote calls.

### Model verification and free-tier limits

Model ID checked on **2026-10-26** against Google's official sources:

- [Gemini API cookbook Get Started](https://github.com/google-gemini/cookbook/blob/550674681574d7aa24304b8fa9b31234e241ed7e/quickstarts/Get_started.ipynb) lists `gemini-3.8-flash` as the default current Flash model.
- [Official REST JSON-mode example](https://github.com/google-gemini/cookbook/blob/550674681574d7aa24304b8fa9b31234e241ed7e/quickstarts/rest/JSON_mode_REST.ipynb) uses that ID with `generateContent` and JSON output.
- [Google's API-key unpaid-tier documentation](https://github.com/google-gemini/gemini-cli/blob/cd1b45c2db0a5ea7b7fc3b67c1ba5879601d6005/docs/resources/quota-and-pricing.md#log-in-with-gemini-api-key-unpaid) describes unpaid Gemini API-key access to Flash models. CLI quotas are **not** this application's quota guarantee.
- Recheck [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), and your project's model access before live use. The documentation site's network destination was blocked during implementation; official GitHub sources above were readable. No authenticated Gemini request or project-specific free-tier entitlement was verified because `GEMINI_API_KEY` was not configured.

Free-tier availability and request/token quotas vary by project, account, region, model and time; quota exhaustion is expected and not a reason to enable billing. This app cannot inspect or enforce your Google project's billing tier. Keeping the project unbilled is the operator's responsibility. **Free tier is neither unlimited nor a guarantee of zero cost if billing is later enabled.** Pinning a model and limiting requests do not prevent charges on a billed project. The adapter uses ordinary text/JSON generation only, with no search, paid tools, batch jobs, provisioned resources or automatic upgrades.

Google may use Free tier input/output to improve products under applicable terms. Review [Gemini API terms](https://ai.google.dev/gemini-api/terms) and data-use rules before live use; do not submit customer personal or confidential information. No conversations or contacts are persisted by this application. Local tests use synthetic responses and require no key, billing or provider calls.

## Safe local diagnostics (opt-in)

Enable only in a private local server terminal:

```sh
AI_DIAGNOSTICS=1 npm start
```

Alternatively put `AI_DIAGNOSTICS=1` in your ignored local `.env` and explicitly load it with `node --env-file=.env server.js`. To disable, remove the variable or set `AI_DIAGNOSTICS=0`, then restart the server. Only the exact string `1` enables it. Demo remains the default provider; enabling diagnostics does not enable Gemini, make probe requests, change models, retry requests, or activate billing. Keep the project unbilled. The automated diagnostic tests simulate all provider failures without any live calls or real keys.

On a provider failure the server writes **one JSON record to stderr**. Example:

```json
{"event":"ai_provider_failure","provider":"gemini","category":"model_access_error","phase":"response_body","httpStatus":404,"elapsedMs":123}
```

The logger constructs records from an allowlist: fixed event/provider/category/phase strings, upstream numeric status (or null before headers), and a bounded elapsed time. It never serializes an exception, stack, cause, error code, URL, model configuration, request/response headers, provider error body, selection text, customer message, or business knowledge. Error bodies are discarded without parsing. Successful calls and normal unknown-answer handoffs are silent. Logger failures cannot change the safe handoff. Keep terminal/hosting logs private; do not enable diagnostics on a shared host or forward stderr to a public log viewer. The application creates no diagnostic files and no public diagnostic route. Existing HTTP 503 `assistant_unavailable` responses stay unchanged.

| Category | Observed signal | What it does and does not establish |
| --- | --- | --- |
| `quota_error` | HTTP 429 | Quota or rate exhaustion; does not establish which quota or justify billing activation |
| `authentication_error` | HTTP 401 | Upstream authentication rejection for that request; not a reason to print or replace the key blindly |
| `model_access_error` | HTTP 403 or 404 | Permission, model, method, API-version or routing/access issue; metadata access does not establish generation access |
| `request_rejected` | HTTP 400 or 422 | Possible request/schema/model compatibility rejection; status alone cannot identify a field |
| `http_error` | Other non-success HTTP status | Upstream HTTP failure with exact numeric status, without response details |
| `network_error` | Transport failure before headers or during body read | Proxy, TLS, DNS, connection or body-stream failure; no raw error details logged |
| `timeout` | Application deadline expires | Aborts request; status may be 200 if headers arrived but the body stalled |
| `invalid_response` | Body/size/JSON/selection/envelope checks fail | Includes blocked, truncated or unsupported content; does not establish provider outage |
| `configuration_error` | Unsupported live provider reaches the transport | Internal configuration issue; normal environment validation fails at startup |

`phase` distinguishes `request` (before response headers), `response_body` (headers received/body handling), and `response_validation` (JSON/completion/selection checks). A non-success status is classified immediately; cleanup does not wait for the rejected body. This is coarse evidence, not an upstream root-cause trace. No raw provider details are collected to resolve ambiguity.

### Gemini compatibility findings and remaining uncertainty

Reported by the user (not rerun in this task): authentication and `GET /v1beta/models` work; metadata for `gemini-2.5-flash` succeeds; `gemini-3.8-flash` generation times out after 60 seconds; `gemini-2.5-flash` generation returns 404. The application still pins `gemini-3.8-flash`; no switch or live probe was performed. A model-list or model-metadata success does **not** prove that the same project/API version supports `generateContent` for that model. The 404 alone does not identify missing credentials or confirm a typo.

Inspection identified these possibilities without changing the request contract:

- The app's default **8-second deadline** covers request and response reading, so its 503 can occur well before an external 60-second timeout. The supported maximum remains 30 seconds. Increasing a deadline is not proof of compatibility or an instruction to repeat calls.
- `candidateCount` and `temperature` were already removed for Gemini 3.8 compatibility and regression-tested. The remaining request uses `systemInstruction`, JSON `responseMimeType`, and a nullable string enum in `responseSchema`. A model/API that rejects any of these can return 400/422; diagnostics record that status without silently dropping grounding constraints.
- Strict validation intentionally requires one candidate, `finishReason: STOP`, one text part, and exactly typed `factId`/`confident` fields. Safety blocks, additional/thought/tool parts, or token-truncated output (including models spending output budget on thinking) can yield HTTP 200 upstream but still trigger `invalid_response` and safe handoff.
- Proxy/TLS/native-fetch setup and generation-method/model access may differ from metadata operations. `network_error`, `timeout`, and an explicit HTTP status are different observations; none alone proves which upstream component failed.

These diagnostics improve local visibility; they do not fix or confirm live Gemini generation availability. Use demo mode while generation remains unresolved. Do not enable billing, paid services, retries, or alternate models to work around it.

## Architecture and knowledge approval

- `src/knowledge.js`: deeply frozen business details, service lists, FAQs, policy summaries, and retrieval restricted to one business. All claims derive from the original demo; empty service lists mean no additional service details are approved. Curated question variants add phrasing, not facts.
- `src/diagnostics.js`: opt-in local failure metadata with strict allowlisting; no public endpoint or raw data logging.
- `src/provider.js`: provider selection/configuration and shared transport with bounded response size, abortable deadline, and strict selection shape; retains optional OpenAI. `src/gemini.js`: isolated Gemini REST request and completion parsing. It asks for a fact ID or uncertainty, never free-form customer-facing text.
- `src/chat.js`: orchestration and output checks. Only IDs in the selected business's FAQs are accepted; answers are the exact approved text, with scoped source IDs. Unknown IDs, uncertainty and failures return a fixed handoff. No model-generated prose is displayed.
- `src/http.js`: routes, body limits, strict request validation, per-socket-IP rate limits, public asset allowlist, and safe errors. `server.js` is the startup entry point.
- `public/app.js`: text-only rendering and generation checks that discard replies from a previous business selection. API keys and provider configuration never reach the browser.
- `server.test.js`, `gemini.test.js`, `diagnostics.test.js`, and `frontend.test.js`: deterministic knowledge, isolation, provider contract/failures/deadlines, HTTP behavior using ephemeral servers, and delayed frontend response isolation. Tests use simulated provider responses; they do not contact Google/OpenAI or need credentials.

Review knowledge changes as code. Add only business-approved facts and question variants. To answer new topics, add approved FAQ text; details/services/policies provide context but are not independently rendered as answers. Unapproved prices, hours, services, policies, or inventory must remain unavailable. Automated tests and human review should accompany knowledge updates.

The AI integration is intentionally constrained retrieval and selection rather than an unrestricted generative chatbot. Exact approved output prevents fabricated text and foreign fact IDs, but a model can still select an irrelevant approved fact, misjudge uncertainty, or be manipulated into choosing the wrong fact. Prompt instructions and model confidence are not a proof of relevance. Evaluate adversarial questions, paraphrases, multi-part questions, and isolation before any real deployment. Demo mode prioritizes safe fallback over broad language coverage.

## HTTP API

`GET /api/businesses` returns public names and sectors only.

`POST /api/chat` requires JSON with exactly `business` (one of `realestate`, `auto`, `retail`, `hotel`) and `message` (nonblank string, maximum 1000 characters). Example:

```json
{"business":"hotel","message":"What is check-in?"}
```

A successful answer contains `message`, `mode` (`demo`, `gemini`, or `openai`), `handoff`, and `sources` (e.g. `hotel:check-in`). Unknown questions return HTTP 200 with `handoff: true` and no sources. Provider failures return HTTP 503 with the same safe handoff plus `error: "assistant_unavailable"`; upstream bodies, credentials and exception details are suppressed. There are no automatic provider retries.

`POST /api/lead` remains a **validation-only demo**, requires a known business, a boolean `consent: true`, and nonblank strings `name` (100 characters), `contact` (150), `question` (400). It neither stores data nor sends it to a provider or staff. Use fictional test values only. No personal information persistence is implemented.

Both POST routes require `application/json`, limit bodies to 12000 bytes, and reject unexpected fields. Errors include 400 (invalid input), 413 (size), 415 (content type), 429 (rate limit, with `Retry-After`), and 503 (provider failure or limiter capacity). Unknown assets/routes are rejected.

## Deployment and security limitations

For the $0 workflow run locally or use an existing host whose free allowance you have independently checked; no new paid host is required. If deploying, use a Node.js-capable host with start command `npm start` and its supplied `PORT`. Static-only hosting is insufficient for API routes. Start with demo mode, run `npm test`, then verify `/`, `/api/businesses`, and a chat request locally or through your deployed HTTPS endpoint. Configure secrets and egress before opting into AI mode. This repository does not include CI deployment or a live-provider acceptance test.

The application stores no conversations, inquiries or customer personal information on disk and does not log request bodies. It temporarily processes request content in memory. Rate limits retain socket IP/count/expiry in memory only, clear expired records on subsequent POST requests, and clear on shutdown; the map is capped at 10000 clients. The limit is 30 POST attempts per IP per 60 seconds, shared across business IDs and API POST routes. It resets on process restart, is not distributed, and deliberately ignores `X-Forwarded-For`. Behind a reverse proxy, users may share a bucket. Deploy an edge limiter with trusted proxy configuration before public use.

HTTP header/request timeouts, response-size limits, no redirect following, public-file allowlisting, content-type checks, CSP, no-store responses, and textContent rendering provide basic protections. They do not replace an HTTPS reverse proxy with body upload deadlines, connection/concurrency limits, monitoring, abuse protection and global provider spend controls. The provider deadline limits upstream wait time, not all deployment resource usage. No authentication, tenant authorization, CSRF token system, durable audit trail, or production human handoff exists. Fictional business selection is public and is not a production tenant security boundary. Host/proxy logs and the AI provider may have their own retention policies. Obtain privacy and security review before real customer use.
