# SlinFish AI Business Assistant — local inquiry foundation

A rules-based demonstration for four **fictional** businesses. Node.js **24.x** is required (tested with 24.19.0; see `.node-version`) for built-in `node:sqlite`. No third-party packages, paid APIs, database account, deployment or API keys are needed.

This branch starts from main independently of Gemini PR #1. It includes no Gemini, OpenRouter, AI provider requests, administrative dashboard, real SlinFish sales capture or notifications. **Use fictional test data only. Do not expose this milestone publicly or use it for real customers.**

## Defaults and configuration

```sh
npm test
npm start
```

The server binds to **127.0.0.1** only. Default `PORT` is 3000. Without `INQUIRY_DB_PATH`, inquiries are validated but not saved: HTTP 200 returns `stored: false` and an explicit message. No database or in-memory substitute is created. Importing server modules does not open a database.

To enable local persistence, set `INQUIRY_DB_PATH` to an **absolute file path in an existing private directory outside the entire checkout**. The file need not exist; it is created with owner-only permissions on POSIX. The parent must have no group/other permissions on POSIX. Existing database files must be private regular files with one hard link; symlinks and shared permissions are rejected. On Windows, protect the directory with NTFS ACLs as shown below; Node's POSIX mode bits cannot establish Windows ACL privacy.

Relative paths, `:memory:`, SQLite URI paths, paths in the checkout/public tree (including resolved symlinks), corrupt databases, unknown schema versions and non-demo database identities fail startup. They do **not** cause validation-only or in-memory fallback. A generic startup error is printed without paths, request data or SQLite details. Unset configuration and failed configuration are different states.

`INQUIRY_DB_PATH` is read by the executable startup and explicit local administrator bootstrap only. `.env.example` documents names; `.env` is not loaded automatically. There are no storage configuration endpoints. Only an operator can change the path. Keep the directory outside other repositories too; Git ignores are a secondary safeguard, not a storage boundary. Do not include the directory in development-environment publication snapshots, source archives or build artifacts.

## Inquiry API and stored fields

`POST /api/lead` requires UTF-8 `application/json` with exactly:

```json
{"business":"hotel","name":"Fictional Tester","contact":"demo@example.invalid","question":"Fictional booking inquiry","consent":true}
```

- `business` must be one of the own keys `realestate`, `auto`, `retail`, `hotel`, as a string. Prototype names, coercible arrays/objects, unknown IDs and `slinfish` are rejected.
- `consent` must be the boolean `true`. Strings such as `"false"` or `"true"` and numeric values are rejected.
- `name`, `contact`, `question` must be nonblank strings with raw maximum lengths **100 / 150 / 400**, matching HTML maxlength (UTF-16 code units). Stored values are trimmed, never truncated. Ill-formed Unicode and control characters are rejected; question text may include ordinary tabs/newlines. Contact is bounded demo text, not a verified email/phone or delivery guarantee.
- Objects/arrays in fields, missing/extra fields, client-assigned status/version/realm and malformed JSON/UTF-8 are rejected. Request bodies are limited to **12000 bytes**, not characters. Compressed bodies are unsupported.
- Browser Origins, when present, must match a localhost or 127.0.0.1 origin at the server's actual port. There is no permissive CORS. This is an abuse check, not authentication; non-browser clients can omit/forge Origin.

With persistence configured, successful committed storage returns HTTP **201**, `stored: true`, an opaque `inquiryId` and a fixed confirmation message. It never echoes name, contact or question. A connection failure can leave the outcome uncertain; no automatic retry or idempotency is implemented yet. The UI prevents duplicate pending clicks but manual retries can still duplicate a committed inquiry.

Rows contain only the submitted business/name/contact/question/consent plus server-generated UUID v4, initial status `new`, UTC millisecond `created_at`/`updated_at`, `expires_at` seven days after creation, and initial `version: 1`. No IP addresses, Origin, browser metadata, chat history or extra request properties are stored. Free-form values cannot be reliably proven fictional by validation: operators must use synthetic values and keep the service local.

SQLite uses schema version 2 (`PRAGMA user_version`), an application identifier and `fictional-demo` realm metadata. Initialization is transactional. STRICT tables, CHECK constraints, an index by business/time, prepared values, WAL mode, a bounded busy timeout and transactions protect integrity. All inserts are validated again at the repository boundary; internal reads require both business and inquiry ID. There is no unscoped read/list API. Existing version 1 databases migrate transactionally to version 2 by adding administrator/session tables; inquiries are preserved exactly. Realm and application identity are checked before migration. Version 2 opens idempotently; unknown versions fail closed. Before upgrading an existing demo database, stop writers and make a private consistent backup; do not copy only the main file while WAL is active. Future migrations must be explicit, never reset unknown data.

The database has a **200-inquiry cap**. At capacity or a write/lock/storage failure, the endpoint returns sanitized HTTP 503 and does not claim success, overwrite earlier inquiries, or switch stores. HTTP 400/413/415 cover invalid fields/JSON, oversized bodies, and unsupported media types; HTTP 403 rejects cross-origin browser submissions.

Submission limits apply before parsing both valid and invalid inquiry attempts: **5 per socket IP per minute**, **50 per process per minute**, with at most 1000 active client entries. HTTP 429 includes `Retry-After`. Forwarded-IP headers are ignored. Limiter state is short-lived in memory and resets on restart; it is not distributed and shared/NAT users share a bucket. The app does not log submission bodies or contact data.

`GET /api/businesses`, rules-based `POST /api/chat`, and the existing public page/assets remain. There is **no inquiry listing, lookup, status-update, deletion, dashboard or real-sales route**. The administrator endpoints below expose authentication metadata only, never inquiry data. Static files are explicitly allowlisted. CSP/no-store/nosniff headers and textContent rendering reduce accidental exposure. Database files and server modules are not served.


## Local administrator authentication (no dashboard)

No administrator exists by default. Starting the app, running tests, migrations or setting an environment variable never supplies a default passphrase or creates an owner. One local owner is created only by explicitly invoking:

```sh
node scripts/admin-bootstrap.js
```

Use a private interactive terminal with `INQUIRY_DB_PATH` pointing to the existing private fictional-demo database. The command accepts **no arguments**, no password environment variable and no piped input; stdin/stdout/stderr must be terminals. It prompts twice with echo disabled and terminal history disabled. Choose a unique 16–128-character passphrase (at least 16 non-padding characters). Never put a passphrase in source, shell arguments/history, transcripts, logs or Git. A second setup attempt is rejected before asking for credentials; database constraints also reject concurrent attempts to create a second owner. Failure messages are fixed and do not print paths, hashes, secrets or exceptions. There is no public registration, bootstrap, reset or password-recovery endpoint. Do not delete the inquiry database to reset credentials; a recovery tool is outside this milestone.

Passphrases use asynchronous Node scrypt (`N=32768`, `r=8`, `p=3`, 64 MiB maximum memory), fresh 128-bit random salts, 64-byte derived hashes and timing-safe comparison. Only salted hashes and KDF parameters are persisted. Transient password strings must exist in client/server memory to perform authentication; JavaScript cannot guarantee their erasure. The bootstrap and server do not print them or write plaintext passwords to disk.

| Endpoint | Request / result |
| --- | --- |
| `POST /api/admin/login` | Same-origin JSON with exactly `password`. Generic HTTP 401 for absent/disabled owner or wrong password. Success sets the session cookie and returns only `authenticated: true` and a CSRF token. No username is needed for this single-owner prototype. |
| `GET /api/admin/session` | Requires a valid cookie; returns only authenticated state and the session-bound CSRF token. HTTP 401 for missing, expired, revoked or malformed/duplicate cookies. No hashes, raw session token or inquiry data in JSON. |
| `POST /api/admin/logout` | Requires JSON `{}`, valid cookie, exact Origin and `X-CSRF-Token`. Revokes the session in SQLite and clears its cookie. Missing/incorrect CSRF is rejected with HTTP 403. |

All administrator requests require a direct loopback peer and an explicit local Host matching the listening port. Mutating requests require an exact Origin matching **that Host, scheme and port**. Missing/null/cross-origin Origins, cross-site Fetch Metadata and invalid/duplicate Hosts are rejected. Login uses mandatory Origin plus JSON enforcement against login CSRF; authenticated mutations additionally use a constant-time checked CSRF token derived from the session secret. A failed CSRF check does not revoke a legitimate session. There is no CORS access for another origin. `X-Forwarded-For`, `X-Forwarded-Host` and `X-Forwarded-Proto` do not establish trust. These endpoints are not designed for a tunnel or reverse-proxy deployment.

Session tokens contain 256 bits of cryptographic randomness, are opaque, and appear only in a host-only HttpOnly, SameSite=Strict cookie. SQLite stores only SHA-256 token hashes. Login always generates a fresh token and transactionally revokes previous sessions; an incoming cookie cannot fix the new session ID. Failed login does not revoke existing sessions. Sessions have 30-minute idle and 8-hour absolute limits; authenticated session checks renew only idle time, never the absolute deadline. Logout revocation persists across restarts. Sessions are additionally bound to the server origin; changing host, port or HTTP/HTTPS context requires login again. Expired/revoked rows are pruned on subsequent logins to keep session metadata bounded.

Direct HTTPS cookies are named `__Host-slinfish-demo-admin` with `Secure` and Path=/; loopback HTTP uses `slinfish-demo-admin` without Secure as a deliberate local-development exception. The exported `createServer({ dbPath, tlsOptions })` accepts native Node HTTPS server options for a separately configured, directly terminated local TLS server. `npm start` remains plain loopback HTTP. No forwarded header enables TLS or weakens certificate validation. Do not transmit real credentials on a public/plaintext connection. The default HTTP workflow is suitable only on a trusted local machine.

Login limits are independent of inquiry limits: **5 attempts per socket IP per 15 minutes and 20 per server instance per 15 minutes**, including successful and malformed attempts. Normal throttles return HTTP 429 with Retry-After. One concurrent scrypt login is allowed per server instance; excess verification work is rejected instead of queued. Missing-owner verification performs a dummy scrypt operation and returns the same credential error. Rate limits are bounded/process-local, reset on restart and do not provide production brute-force resistance. No credentials, raw cookie headers, CSRF tokens, hashes, request bodies or exception stacks are logged by the application.

## Windows PowerShell verification

These commands assume PowerShell is opened at the repository root. They are documented for Windows; the development verification was executed on Linux/Node 24.19.0. The POSIX-permission test intentionally skips on Windows, where ACLs require separate verification.

Check the runtime and run the complete checks (no dependency installation needed):

```powershell
$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -ne 24) { throw 'Install Node.js 24.x before continuing.' }
node --version
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
$files = @('server.js', 'server.test.js') + @(Get-ChildItem -Path src,test,public,scripts -Filter *.js -Recurse -File | ForEach-Object { $_.FullName })
foreach ($file in $files) {
    node --check $file
    if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $file" }
}
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'Whitespace check failed.' }
```

First verify validation-only behavior if desired: remove any pre-existing storage binding in this terminal with `Remove-Item Env:INQUIRY_DB_PATH -ErrorAction SilentlyContinue`, then `npm.cmd start`. Stop with Ctrl+C before enabling storage.

Create a dedicated directory outside Git and protect it. Review the path before changing its ACL; use only a dedicated SlinFish demo directory on an NTFS volume, not a shared/system folder:

```powershell
$demoData = Join-Path $env:LOCALAPPDATA 'SlinFishDemo'
New-Item -ItemType Directory -Path $demoData -Force | Out-Null
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $demoData /inheritance:r /grant:r "${account}:(OI)(CI)F"
if ($LASTEXITCODE -ne 0) { throw 'Unable to secure the demo directory.' }
icacls $demoData
$env:INQUIRY_DB_PATH = Join-Path $demoData 'inquiries.sqlite'
$env:PORT = '3000'
npm.cmd start
```

Confirm the ACL output has no unintended explicit grants; `/inheritance:r` removes inherited entries but does not remove old explicit grants. Prefer a fresh private directory. Full-disk encryption and secure backups are not configured by this application.

In a **second PowerShell terminal at the repository root**, submit only a fictional inquiry and verify private storage. Keep the receipt ID in that terminal:

```powershell
$body = @{
    business = 'hotel'
    name = 'Fictional Tester'
    contact = 'demo@example.invalid'
    question = 'Fictional booking inquiry'
    consent = $true
} | ConvertTo-Json
$receipt = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/lead' -Method Post -ContentType 'application/json' -Body $body
if ($receipt.stored -ne $true) { throw 'Persistence was not enabled.' }
$env:VERIFY_INQUIRY_ID = $receipt.inquiryId
$env:INQUIRY_DB_PATH = Join-Path (Join-Path $env:LOCALAPPDATA 'SlinFishDemo') 'inquiries.sqlite'
node --input-type=module -e "import {openInquiryStore} from './src/inquiries/sqlite.js'; const s=openInquiryStore(process.env.INQUIRY_DB_PATH); try { const r=s.get('hotel',process.env.VERIFY_INQUIRY_ID); if(!r) throw Error('Missing inquiry'); console.log(JSON.stringify({found:true,status:r.status,version:r.version})); } finally { s.close(); }"
if ($LASTEXITCODE -ne 0) { throw 'Private storage verification failed.' }
```

Stop and restart `npm.cmd start` in the first terminal (its environment variables remain set). Repeat **only the private read command** in the second terminal; it must still find the same receipt. This is a filesystem-level operator check, not a public listing endpoint. `npm.cmd test` independently starts/stops two real Node application processes against a temporary SQLite file and verifies the persisted row. All test databases use temporary private directories and are removed afterward.

Do not expose the server through a tunnel/proxy or use a deployment host for this milestone. Do not copy only the main SQLite file while WAL is active; a future backup facility must take a consistent snapshot. Unsetting `INQUIRY_DB_PATH` disables subsequent storage but does not delete an existing database.


### Windows: one-time administrator setup and authentication checks

Use a private Windows Terminal/PowerShell console, not ISE, a pipeline, output redirection or a recorded/debug session. Stop the running application before the initial migration/bootstrap and preserve a private consistent backup if you already have inquiries. Reuse the protected directory configured above; do not create a different database accidentally.

```powershell
$env:INQUIRY_DB_PATH = Join-Path (Join-Path $env:LOCALAPPDATA 'SlinFishDemo') 'inquiries.sqlite'
node scripts/admin-bootstrap.js
if ($LASTEXITCODE -ne 0) { throw 'Administrator setup unavailable or already completed.' }
# Type a unique passphrase twice at the masked prompts. Do not put it in this command.
$env:PORT = '3000'
npm.cmd start
```

The command is one-time: running it again fails without replacing the administrator or erasing inquiries. No default/test passphrase is valid on your database. All automated test credentials and databases are synthetic and temporary.

In a second private PowerShell terminal at the repository root, verify login/session/logout without printing passphrases, cookie values or CSRF tokens. This local HTTP procedure assumes port 3000 and uses the **same 127.0.0.1 origin throughout**. Do not enable PowerShell transcription or verbose HTTP debugging. The passphrase is read as SecureString, converted only transiently for JSON, and is not embedded in shell history:

```powershell
$origin = 'http://127.0.0.1:3000'
$webSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$securePass = Read-Host 'Administrator passphrase' -AsSecureString
$loginJson = $null
try {
    $loginJson = @{ password = ([System.Net.NetworkCredential]::new('', $securePass)).Password } | ConvertTo-Json -Compress
    $auth = Invoke-RestMethod -Uri "$origin/api/admin/login" -Method Post -ContentType 'application/json; charset=utf-8' -Headers @{ Origin = $origin } -WebSession $webSession -Body $loginJson
    if ($auth.authenticated -ne $true) { throw 'Login verification failed.' }
} catch {
    throw 'Login failed; check the passphrase, Origin, running server and rate limit without dumping request data.'
} finally {
    $loginJson = $null
    $securePass.Dispose()
    $securePass = $null
}
$state = Invoke-RestMethod -Uri "$origin/api/admin/session" -Method Get -Headers @{ Origin = $origin } -WebSession $webSession
if ($state.authenticated -ne $true) { throw 'Session verification failed.' }
$logoutHeaders = @{ Origin = $origin; 'X-CSRF-Token' = $state.csrfToken }
Invoke-RestMethod -Uri "$origin/api/admin/logout" -Method Post -ContentType 'application/json; charset=utf-8' -Headers $logoutHeaders -WebSession $webSession -Body '{}' | Out-Null
$unauthorized = $false
try {
    Invoke-RestMethod -Uri "$origin/api/admin/session" -Method Get -Headers @{ Origin = $origin } -WebSession $webSession | Out-Null
} catch {
    if ([int]$_.Exception.Response.StatusCode -eq 401) { $unauthorized = $true }
    else { throw 'Unexpected session verification failure.' }
}
if (-not $unauthorized) { throw 'Logout did not invalidate the browser session.' }
$auth = $null
$state = $null
$logoutHeaders = $null
$webSession = $null
Write-Host 'Login, session and logout checks passed.'
```

Do not inspect or print the web-session cookie collection, login JSON, `$auth`, or `$state`. The automated suite independently tests server-side replay rejection after logout even if the old cookie is retained, expiry, wrong-CSRF/Origin/Host rejection, session fixation, throttling, migration preservation and rollback behavior. Windows commands are provided for operator verification but were not executed on Windows here; actual masked-prompt behavior was checked in a Linux PTY with temporary synthetic credentials, then the database was removed.

## Current limits and next review

This includes inquiry persistence and local authentication, but not the dashboard/management system described in [the architecture](docs/lead-management-architecture.md). One-owner local authentication and sessions are implemented, but no dashboard, durable abuse protection, request idempotency, encryption-at-rest, backup/restore workflow, retention purge, or inquiry deletion controls are implemented. **Expiry is metadata only at this stage**: records are not automatically erased after seven days, and all retained rows count toward the cap. Do not accept real personal information. Database isolation is not authentication against another process running as the same OS user; path checks assume an operator-controlled private directory, not a hostile filesystem.

Synchronous SQLite can briefly block the event loop, including up to the one-second busy timeout; this is a bounded local demonstration. Process-local rate limiting is bypassable by restart and is not sufficient for a public service. No production multi-tenant guarantees are claimed. Contact/name/question content has format/length checks, not a guarantee of accuracy or fictionality. A dropped response after COMMIT can lead to duplicate manual submissions.

Real SlinFish sales capture remains disabled: no such business ID or route exists. No external AI receives inquiries. Any next milestone, dashboard, deployment, real-data use, credential recovery or further migration requires review and separate approval. Nothing is merged into main.
