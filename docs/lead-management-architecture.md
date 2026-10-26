# Lead capture and management — architecture for approval

Status: historical Task 2A architecture and approval baseline. Task 2B authorizes the validation/local SQLite foundation; Task 2C adds one-owner local bootstrap/authentication/sessions with an additive schema migration. See README for actual implemented behavior. Task 2C.2 adds owner-controlled local password reset and atomic session revocation without a schema change. Task 2D adds the local protected dashboard, scoped management API and additive schema-3 status history; see [the implemented contract](lead-dashboard-api.md). Real customer records, deletion, deployment and paid services remain outside the milestone.

Branch: `feat/lead-management`, created directly from current remote `main`, commit `052247cba55749a997613bcd539c65caa869fd5f`. Gemini PR #1 and branch `feat/grounded-ai-knowledge` are independent: no merge, cherry-pick, or edits to their integration/diagnostic tools. Their improvements must not be assumed present here.

## Recommendation

Build a small Node.js application with SQLite on an existing local machine first. Keep the four fictional businesses and demonstrate persistent inquiry creation, a protected dashboard, status changes, and deletion using server-generated fictional scenarios. Keep real SlinFish sales capture disabled until its separate privacy and deployment checks pass.

Use two deployment modes with separate processes/origins and separate database files if both are operated: `demo` (default) and `sales`. One process opens only its own database. A public request cannot select or switch that mode. Do not add SlinFish Software to the four fictional business configurations as if it were another demo business.

This produces a useful sales demonstration without paid AI, identity providers, databases, hosting, email delivery or subscriptions. It does not make the prototype production-ready. Real inquiries would be managed manually through the dashboard; staff notifications are outside this first implementation.

## Audit of main

| Area | Observed behavior and implication |
| --- | --- |
| Form fields | `public/index.html`: required name (100-character HTML limit), contact (150), question (400), consent checkbox acknowledging a demo. `public/app.js` adds the currently selected business and converts consent to a boolean. |
| Backend validation | `server.js`: checks truthy business lookup and consent; requires name/contact/question to be strings, nonblank after trimming, and each shorter than 500 characters. Does not align with HTML limits, require boolean consent, reject extra properties, or strictly validate business ownership/type. Values are not normalized before further use. |
| Confirmed validation weaknesses | Synthetic requests with `business: "constructor"` and `consent: "false"` were accepted. Inherited object properties pass the business lookup. JSON sent as `text/plain` is accepted. A 499-character name is accepted; 500 is rejected. These need correction before any persistent write. |
| Inquiry persistence | `POST /api/lead` returns a demo-only message; it neither stores nor delivers anything. No admin routes, lead listing, status fields, database, migrations or backup facility exist. |
| Other routes | `GET /api/businesses` exposes the fictional configurations and FAQ text. `POST /api/chat` uses keyword matching and a fallback; validates message type/maximum length but accepts blank messages. GET requests otherwise read files under `public/` with a resolved-path containment check. Other methods generally return 405. |
| Request handling | Node `http`, ESM, no framework/dependencies. Body accumulation rejects after 12000 string characters, rather than a strict UTF-8 byte budget. No content-type or Origin enforcement. Malformed JSON, internal failures and missing files become generic 400/404 responses. No explicit application upload/concurrency limits. |
| Existing security | Responses set `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`. Browser chat content uses `textContent`. No authentication, sessions, authorization, CSRF protection, CSP, login throttling, submission rate limiting or durable abuse controls. No configured trusted-proxy boundary. |
| Frontend state | Switching business redraws chat, but pending replies/inquiry results are not tied to a selection generation. A delayed result could appear after a switch. Forms do not robustly distinguish HTTP failures from success or clear data after acceptance. |
| Tests | `server.test.js`: two tests for one approved FAQ answer and unknown-answer fallback. No HTTP, inquiry validation, isolation, authentication, storage or deletion tests. |
| Deployment | README requires Node 20+ and a Node-capable host with `PORT`; static-only hosting is insufficient. No deployment manifests, CI workflows, lockfiles, database configuration or persistent-volume contract are supplied. |

Audit verification: `npm test` passed 2/2, with no failures or skips. An ephemeral local server confirmed the validation observations above using fictional values only; the existing endpoint persists no records. Runtime here is Node 24.19.0 and exposes `node:sqlite.DatabaseSync`; no database was created during the audit.

## Product and data separation

### Fictional demonstration

- Retain `realestate`, `auto`, `retail`, and `hotel` with their existing fictional identities.
- Replace the free-form demo inquiry submission with approved scenario choices. Accept only a business ID, an approved scenario ID, a submission key, and a strict boolean demo acknowledgement. The server creates the fictional name, `.invalid` contact and question from its own fixture catalog.
- Display those sample values as a preview and label them clearly. Do not persist client-provided names, contacts, free-form chat, or questions in the demo database. A warning alone cannot guarantee users type fictional personal information.
- The protected demo dashboard demonstrates actual SQLite writes and status changes. Public visitors cannot list or modify records. Presets and per-business scope keep the demonstration convincing without collecting personal data.

### Eventual real SlinFish inquiries

- A separate, clearly branded SlinFish sales form and privacy notice; the existing footer link can remain until this is separately approved.
- Sales mode has only the fixed `slinfish` business scope. Public clients cannot choose a tenant, demo/sales flag, status, owner, expiration or audit fields.
- Initial real fields: name, email contact, and a short project inquiry, with purpose acknowledgement. Choosing email-only contact makes validation and follow-up explicit; the current generic contact field is suitable only for the fictional demo.
- No marketing consent implied by an inquiry; no chat transcripts, attachments, private documents, sensitive identifiers, billing or profiling. No lead data enters chat prompts or an AI provider.
- Separate origin, cookie name, database, backups and administrator bootstrap from demo. Switching tabs or manipulating a request must never move data between realms.
- Real capture remains off until an operator approves the notice, retention, access controls and durable storage. This architecture task creates no such records.

## Storage and deployment options

| Approach | Local behavior | After deployment | Decision |
| --- | --- | --- | --- |
| SQLite on an existing machine | Persistent private file, transactions, indexes, schema checks and simple backups; no database server or account | Works on a single Node instance only if its disk is durable, private and survives restarts/redeploys. Keep data outside the checkout/public tree. Existing hardware has no new service fee but still needs uptime and maintenance. | Recommended for the first demonstration. |
| SQLite on an ephemeral free web host | Works during a process lifetime | Files may disappear on sleep/restart/redeploy. A free web process does not imply a free persistent volume. Publishing or snapshotting a development workspace is not a customer-data persistence/backup contract. | Disposable synthetic demo only; never claim durable storage or accept real sales leads there. |
| Cloudflare Workers Free + D1 Free | Local tooling can emulate the database for development | D1 supplies managed SQLite-compatible persistence rather than a local file. Requires a Workers HTTP adapter and D1 repository adapter; the Node `http` entry point and `node:sqlite` implementation cannot run unchanged. Account limits, availability, data location and backup/export behavior must be reviewed. Stay within a verified unbilled plan; no paid upgrade or billing activation. | Possible later public $0 deployment, after explicit approval and verification of current free-plan terms. Not a zero-change deployment of this proposal. |
| Hosted PostgreSQL free tier | A local or remote PostgreSQL service adds setup, drivers and credentials | A verified unbilled tier may provide durable shared storage, but adds external service dependency, quotas, suspension/retention policies, region and credential management. Free web hosting is still a separate problem. | Defer; no need for a database server for this prototype. No free entitlement or backup guarantee is assumed. |
| JSON/JSONL file or browser storage | No service cost, but needs custom atomic writes/locking/recovery; browser data belongs to one device | Ephemeral-disk limitations remain. Browser storage cannot provide a protected shared administrative database. Version-control commits are not a safe lead store. | Reject for the lead system; SQLite already solves these problems better. |

No deployment provider was provisioned or selected. Free-tier terms must be checked when deployment is approved; do not promise unlimited quotas, free durable disk or zero cost on a billed account. Reference candidates: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/). Current quotas were not verified in this audit.

For the local implementation, pin Node 24 LTS and use built-in `node:sqlite` after confirming the chosen patch's support/stability. This changes the current Node 20+ requirement; do not silently assume Node 20 has the module. Use prepared statements and small indexed queries. Synchronous SQLite access is acceptable for this bounded, single-process demonstration; keep backups, large purges and expensive maintenance out of request handlers. Do not add a native database dependency unless a confirmed runtime constraint warrants a separate decision.

Use a repository interface so validation/auth/UI do not depend on SQLite or D1 APIs. Only a later approved deployment adapter should replace the storage implementation.

## Recommended data model

One schema per database, with a single immutable database-identity row (`realm`, schema version). Startup verifies identity against deployment mode and fails closed on mismatch. Demo and sales paths must be distinct; never attach the other database to a connection.

| Entity | Fields / rules |
| --- | --- |
| `inquiries` | `id` (cryptographically random UUID), `business_id`, `name`, `email`, `question`, `status`, `created_at`, `updated_at`, `expires_at`, `version`, `notice_version`, `acknowledged_at`, `submission_key_hash`. Timestamps are server-assigned UTC. Demo values are generated fixtures; sales fields are validated. |
| `inquiry_events` | Business-scoped inquiry reference, event ID, actor ID, old/new status and timestamp. No copies of name, contact or question. Foreign key `(business_id, inquiry_id)` references the same scoped inquiry and cascades on deletion. This is modest workflow history, not a compliance audit system. |
| `admins` | One owner account initially: opaque ID, login name, salted password hash with KDF parameters, credential version and enabled flag. Bootstrap/reset is local, never a public registration route. |
| `admin_sessions` | Hash of a random session token, admin ID, creation/last-seen times, idle and absolute expirations, credential version, CSRF synchronizer token and recent-authentication time. No plaintext session token or raw password persisted. |
| Database identity/migrations | Realm marker and applied migration versions. Migrations run once at startup before accepting requests, with backup/rollback planning. |

Canonical stored statuses: `new`, `contacted`, `qualified`, `closed`; display as New, Contacted, Qualified, Closed. Creation always assigns New. Owner may move between these statuses, including reopening to New; no-op updates create no duplicate event. Updates require the last observed `version`; mismatches return 409 and prompt refresh. Mutation and event insert are one transaction.

Enforce NOT NULL, length constraints, allowed statuses, realm-specific business IDs, foreign keys, and uniqueness of `(business_id, submission_key_hash)`. Use an index on `(business_id, status, created_at, id)`. Every repository operation requires a server-derived realm and authorized business scope, including details, counts, updates, events and deletes. Random IDs supplement authorization; they never replace it.

A retry with the same valid submission key and same normalized payload returns a generic acknowledgement without duplicate storage. Compare normalized fields privately when checking duplicate content. A reused key with different content returns generic 409; do not echo the original data. The key is not a retrieval credential or spam defense.

## API and UI plan

Only routes for the server's configured realm exist. Tables below describe the complete proposed interface, not current implemented routes.

| Method and route | Access / behavior |
| --- | --- |
| `GET /api/businesses` | Preserve current fictional catalog in demo mode. Sales form is separate; do not mix real business identity into this catalog. |
| `POST /api/demo/businesses/:businessId/inquiries` | Public, demo mode only. Strict scenario/business allowlists and boolean demo acknowledgement; server generates fixture fields. Returns generic acceptance and opaque receipt after a committed write. |
| `POST /api/sales/inquiries` | Public, sales mode only and disabled until approved. Validated minimal real inquiry, strict boolean purpose acknowledgement and a displayed notice version matching the current approved version; server assigns SlinFish scope and stored notice metadata. No automatic email or AI call. |
| `POST /api/admin/login` | Strict same-origin JSON, rate-limited password verification; rotates session on success. Generic login errors. |
| `GET /api/admin/session` | Authenticated session metadata and CSRF token only, with no-store. No password, session-token value or customer content. |
| `POST /api/admin/logout` | Authenticated plus Origin/CSRF checks; revoke session and clear cookie. |
| `GET /api/admin/businesses/:businessId/inquiries` | Authenticated/authorized; scoped status filter and cursor pagination, default 25/max 50. Minimal summary fields; never unlimited exports. |
| `GET /api/admin/businesses/:businessId/inquiries/:id` | Authenticated/authorized; scoped details and bounded event history. Missing and out-of-scope IDs both return 404. |
| `PATCH /api/admin/businesses/:businessId/inquiries/:id` | Authenticated/authorized plus Origin/CSRF checks; only status and expected version accepted. |
| `DELETE /api/admin/businesses/:businessId/inquiries/:id` | Same authorization and CSRF; a login within the last 10 minutes and explicit UI confirmation for real data; otherwise require a fresh login. Hard-delete related events transactionally. No GET deletion. |

`/admin` shows a login screen and, after authentication, business-filtered list/details/status controls. A conspicuous realm banner persists on all screens. Public static HTML/JS contains no embedded lead records or secrets. Changing business cancels/discards pending requests; server authorization remains authoritative. No customer-facing list/detail lookup, public admin registration, bulk export, free-form staff notes or attachments in the first increment.

The old `POST /api/lead` must stop accepting arbitrary free-form demo payloads when persistence is introduced. Update the same-origin frontend to the new mode-specific route and return a clear migration/deprecation error from the legacy route; do not silently turn it into a real-data collector.

## Administrative authentication

Use one owner per deployment realm initially, not a shared demo credential with access to real inquiries. No paid identity provider, social login, password-reset email or multi-user roles are needed for the first version.

- A local TTY-only bootstrap/reset CLI prompts for a strong passphrase without echo; no plaintext password in source, command arguments, URLs or browser storage. No credentials are collected during architecture approval.
- Use built-in asynchronous `crypto.scrypt`, a fresh random salt of at least 16 bytes and timing-safe hash comparison. A candidate resource budget is `N=32768, r=8, p=3`, with sufficient explicit max memory; benchmark the approved host before locking parameters. Bound verification concurrency and queue size to avoid exhausting a free instance. Store parameters with the hash so upgrades are possible.
- Use 32-byte random opaque session tokens; store only their hashes in SQLite. Initial limits: 30 minutes idle and 8 hours absolute, with server-side expiry checks. Password reset revokes all sessions immediately.
- Production cookies are Secure, HttpOnly, SameSite=Strict, host-only, Path=/, with separate realm-specific names (`__Host-slinfish-demo-admin` / `__Host-slinfish-sales-admin`). Never put bearer/session tokens in localStorage. Use separate hostnames for realms; ports alone do not isolate cookies.
- A deliberate loopback-only HTTP development exception may use a non-`__Host-` demo cookie and synthetic data only. Real capture requires an explicitly configured HTTPS origin and trusted TLS termination. Trust forwarding headers only from explicitly configured proxies.
- All state changes, including logout, require exact configured Origin and session-bound CSRF token; login requires Origin plus JSON enforcement. No permissive credentialed CORS. A hidden admin URL is not authentication.
- No business-employee login or production tenant authorization is claimed. If added later, introduce explicit admin-to-business grants and negative access tests; the initial owner can manage allowed businesses within one realm only.

## Abuse prevention and privacy

Before enabling persistence, independently fix main's inherited-key business check, truthy consent, inconsistent lengths, loose request shapes and content types. Use own-property allowlists, trimmed bounded strings, strict booleans and reject unknown fields. Initial sales limits: name 100, email 150, inquiry 400 characters; keep a separate 12 KiB byte-based request budget, strict `application/json`, finite header/body deadlines and bounded concurrent requests. Validate ordinary email syntax/length without implying ownership verification.

Prepared SQL parameters handle every value; sort/filter identifiers come from fixed allowlists. Render all stored content with `textContent`, never HTML. Keep static routes on a file allowlist. Add CSP, frame restrictions, no-store for admin/PII responses and generic error codes. Database files, WAL/SHM files, backups and credentials must never be in `public/`, repository history, build artifacts or a published development-environment snapshot.

Proposed starting limits, to tune using synthetic tests: 3 public submissions/IP/hour, 30 submissions/process/hour, 5 failed login attempts/IP/15 minutes, bounded one-at-a-time KDF work. Use socket identity unless a trusted proxy is explicitly configured; untrusted `X-Forwarded-For` must not bypass limits. Keep limiter state bounded and short-lived, using keyed IP digests rather than persistent raw IP logs. Limits are not distributed or a guarantee against spam; NAT/shared-proxy false positives and denial-of-service remain possible. A server-validated honeypot can supplement these controls, but does not replace them. No external CAPTCHA service is required initially.

Cap the demo database at 200 active sample inquiries with predictable sample cleanup. Cap sales intake initially at 1000 retained inquiries; at capacity or storage failure, reject safely without silently deleting real leads or claiming acceptance. Check capacity and insert in one transaction; handle SQLITE_FULL/SQLITE_BUSY safely. A successful acceptance means committed storage, not delivery to a team member. Request bodies and contact data do not enter access logs, error traces or AI prompts.

Before real use, publish a clear notice identifying the operator, purpose, fields, retention, access/deletion channel and the fact that notifications are manual. Legal basis/notice wording need operator review appropriate to the intended jurisdiction; a demo checkbox is not a real privacy notice. No marketing enrollment or sensitive information collection is included.

## Retention, deletion and operations

Suggested initial policies for approval: demo records expire after 7 days; sales inquiries after at most 90 days from creation. Closing a sales inquiry shortens its expiration to the earlier of its current expiration or 30 days after closing. Edits/reopening do not silently extend retention. The approved policy is server-configured and versioned, never supplied by a public request.

Purge on startup and periodically while running; hide expired records from admin queries immediately. Sleeping/offline instances cannot promise scheduled purge timing, so an operator must run retention cleanup before bringing an old instance back into service. Provide a local maintenance command for explicit purge and backup/restore checks; do not expose a public purge endpoint.

For SQLite: private data directory, restrictive directory/file permissions, `foreign_keys=ON`, WAL on a supported local filesystem, short bounded busy timeout and transactions. Do not use a shared network filesystem for multi-instance writes. Use SQLite-supported consistent backup/snapshot operations, not copying only the main file while WAL is active. Keep rolling backups private, encrypted using an existing trusted OS/storage facility, outside the served tree and Git, with an initial 7-day maximum backup retention. Plan a restore test and database-identity verification. No snapshot or backup is created in this architecture task.

Admin deletion removes the live row and associated events immediately. SQLite free pages, WAL and backups can retain historical bytes; do not promise forensic erasure. Backups expire within the documented window. Before restoring, apply the current retention policy and reconcile any owner-maintained minimal deletion-suppression records so deleted leads are not reintroduced; establish this operational procedure before real-data approval. A deletion requester must be verified privately by the owner; no unauthenticated lookup by email.

## Implementation milestones (after approval)

1. **Foundation:** agree on synthetic scenario UX, realm separation and retention; independently refactor main's HTTP/validation code, add static allowlists, byte limits, request tests and storage interface. Preserve current chat behavior; import nothing from Gemini PR #1.
2. **Synthetic persistence:** add Node 24 pin, SQLite schema/migrations/repository, mode/DB identity checks, prepared statements, scoped queries, idempotency, capacity controls and restart tests using fictional fixtures.
3. **Restricted administration:** bootstrap/reset command, password hashing, session/CSRF lifecycle, login throttling, list/details/status/delete endpoints, optimistic concurrency and admin UI. Verify isolation, XSS handling and no PII in logs/responses to unauthenticated users.
4. **Operational safety:** retention/purge, backup/restore rehearsal, documentation, realistic local sales presentation, visible mode banners and abuse tests. Demonstrate manually with synthetic records only.
5. **Separate real-data/deployment gate:** select and verify an actually durable $0 platform, review privacy notice and operational ownership, confirm TLS/cookies and deletion/restore procedures. Only then approve enabling a separate SlinFish sales deployment. No real capture or deployment is authorized merely by approving the earlier milestones.

## Expected files to change during implementation

These were the anticipated Task 2A paths. Task 2B implements a smaller subset under `src/inquiries/`; README describes current behavior. The remaining paths are proposals, not instructions to create them now:

- `server.js`: small startup entry point; keep provider/Gemini work out of this branch.
- `src/http.js`, `src/validation.js`, `src/businesses.js`: independently authored HTTP routes, request validation and existing fictional catalog extraction.
- `src/leads/service.js`, `src/leads/repository.js`, `src/leads/sqlite.js`, `src/leads/migrations/*.sql`: scope-aware lead workflow, storage contract, SQLite and schema.
- `src/admin/auth.js`, `src/admin/sessions.js`, `src/security/rate-limit.js`: owner authentication, sessions/CSRF and bounded abuse controls.
- `public/index.html`, `public/app.js`, `public/style.css`: synthetic scenario form, honest acceptance language and request-selection handling.
- `public/admin.html`, `public/admin.js`, `public/admin.css`: protected-data dashboard client; all data still requires authenticated API calls.
- Optional later `public/sales.html`, `public/sales.js`: real SlinFish form, approved notice and separate sales mode only.
- `scripts/admin-bootstrap.js`, `scripts/lead-maintenance.js`: local operator actions, no credential output.
- `server.test.js`, `test/*.test.js`: HTTP, persistence, auth, isolation, retention and browser-state regression coverage.
- `package.json` plus runtime pin, `.env.example`, `.gitignore`, `README.md`: Node 24 requirement, commands, non-secret mode/storage options and ignored private data. Never include database files or credentials.

## Test strategy and approval boundary

Use Node's built-in test runner and temporary private SQLite files, with fictional `.invalid` contacts only. Check persistence by closing and reopening the database, and run separate realm databases with the same inquiry ID to catch scope mistakes. Assert unauthorized list/details/update/delete attempts reveal no records, including cross-business IDs, constructor/prototype business keys, scope tampering and wrong-realm database files.

Test strict request bytes/content type/shapes, boolean consent and notice handling, size boundaries, SQL injection values, XSS strings, CSRF/Origin failures, cookie attributes, expiry/logout/reset revocation, login throttling and spoofed forwarding headers. Test valid status changes, invalid statuses, concurrent update conflicts, transactional rollback, idempotent duplicates, record capacity and simulated storage failure without false success.

Use an injected clock for retention and session expiry. Verify hard deletion/event cascade, expired-record hiding, purge repeatability, WAL-consistent backup/restore and the deletion reconciliation procedure. Verify plaintext passwords/session tokens and customer fields never enter captured logs or public responses. Keep authentication tests resource-aware while retaining at least one real KDF round-trip.

Use ephemeral local HTTP servers for API checks; no paid APIs or live customer data. Manual browser acceptance covers scenario-to-admin workflow, business switching, concurrent/stale requests, mobile layout, status updates and deletion confirmation. Dashboard end-to-end tools, if later needed, are a separate dependency decision. A passing formatter or two existing FAQ tests alone cannot validate lead management.

Task 2A created this document without feature implementation. Task 2B now implements strict validation, opt-in local SQLite storage, scoped internal reads and submission rate limits. Its explicit request to store submitted fields supersedes the scenario-generated fixture UX proposed above for this milestone: only fictional, explicitly submitted values are supported, with prominent warnings and no automatic fixture generation. Expiry timestamps are stored but retention/deletion operations, request idempotency, dashboards and real sales capture remain proposed future work. Task 2C adds passphrase-only single-owner bootstrap, scrypt hashes, origin-bound hashed-token sessions, login/logout/session endpoints, CSRF and login throttling. Task 2C.2 adds a separate masked local reset CLI preserving inquiries and revoking all sessions atomically; it does not add inquiry listing/mutation routes, public password recovery or a dashboard. No real inquiry capture, credential disclosure, deployment, merge, cherry-pick or paid-service activation is authorized. Further milestones must wait for review.


Task 2D implementation supersedes the earlier proposed closed status with the explicit new/contacted/qualified/won/lost workflow. The local dashboard supports authenticated filtering, details, version-checked transitions and scoped audit pagination. Legacy closed inquiries are preserved for explicit outcome classification. Deletion, retention purge, real sales capture and deployment remain deferred. The README and dashboard API contract describe current behavior; earlier sections remain the historical proposal.
