# SlinFish AI Business Assistant — local inquiry foundation

A rules-based demonstration for four **fictional** businesses. Node.js **24.x** is required (tested with 24.19.0; see `.node-version`) for built-in `node:sqlite`. No third-party packages, paid APIs, database account, deployment or API keys are needed.

This branch starts from main independently of Gemini PR #1. It includes no Gemini, OpenRouter, AI provider requests, administrative dashboard, authentication, real SlinFish sales capture or notifications. **Use fictional test data only. Do not expose this milestone publicly or use it for real customers.**

## Defaults and configuration

```sh
npm test
npm start
```

The server binds to **127.0.0.1** only. Default `PORT` is 3000. Without `INQUIRY_DB_PATH`, inquiries are validated but not saved: HTTP 200 returns `stored: false` and an explicit message. No database or in-memory substitute is created. Importing server modules does not open a database.

To enable local persistence, set `INQUIRY_DB_PATH` to an **absolute file path in an existing private directory outside the entire checkout**. The file need not exist; it is created with owner-only permissions on POSIX. The parent must have no group/other permissions on POSIX. Existing database files must be private regular files with one hard link; symlinks and shared permissions are rejected. On Windows, protect the directory with NTFS ACLs as shown below; Node's POSIX mode bits cannot establish Windows ACL privacy.

Relative paths, `:memory:`, SQLite URI paths, paths in the checkout/public tree (including resolved symlinks), corrupt databases, unknown schema versions and non-demo database identities fail startup. They do **not** cause validation-only or in-memory fallback. A generic startup error is printed without paths, request data or SQLite details. Unset configuration and failed configuration are different states.

`INQUIRY_DB_PATH` is read only by the executable startup. `.env.example` documents names; `.env` is not loaded automatically. There are no storage configuration endpoints. Only an operator can change the path. Keep the directory outside other repositories too; Git ignores are a secondary safeguard, not a storage boundary. Do not include the directory in development-environment publication snapshots, source archives or build artifacts.

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

SQLite uses schema version 1 (`PRAGMA user_version`), an application identifier and `fictional-demo` realm metadata. Initialization is transactional. STRICT tables, CHECK constraints, an index by business/time, prepared values, WAL mode, a bounded busy timeout and transactions protect integrity. All inserts are validated again at the repository boundary; internal reads require both business and inquiry ID. There is no unscoped read/list API. Only known schema version 1 is supported; future migrations must be explicit, never reset unknown data.

The database has a **200-inquiry cap**. At capacity or a write/lock/storage failure, the endpoint returns sanitized HTTP 503 and does not claim success, overwrite earlier inquiries, or switch stores. HTTP 400/413/415 cover invalid fields/JSON, oversized bodies, and unsupported media types; HTTP 403 rejects cross-origin browser submissions.

Submission limits apply before parsing both valid and invalid inquiry attempts: **5 per socket IP per minute**, **50 per process per minute**, with at most 1000 active client entries. HTTP 429 includes `Retry-After`. Forwarded-IP headers are ignored. Limiter state is short-lived in memory and resets on restart; it is not distributed and shared/NAT users share a bucket. The app does not log submission bodies or contact data.

`GET /api/businesses`, rules-based `POST /api/chat`, and the existing public page/assets remain. There is **no public inquiry listing, lookup, status-update, deletion, admin or real-sales route**. Static files are explicitly allowlisted. CSP/no-store/nosniff headers and textContent rendering reduce accidental exposure. Database files and server modules are not served.

## Windows PowerShell verification

These commands assume PowerShell is opened at the repository root. They are documented for Windows; the development verification was executed on Linux/Node 24.19.0. The POSIX-permission test intentionally skips on Windows, where ACLs require separate verification.

Check the runtime and run the complete checks (no dependency installation needed):

```powershell
$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -ne 24) { throw 'Install Node.js 24.x before continuing.' }
node --version
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
$files = @('server.js', 'server.test.js') + @(Get-ChildItem -Path src,test,public -Filter *.js -Recurse -File | ForEach-Object { $_.FullName })
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

## Current limits and next review

This is the first foundation milestone, not the administrative system described in [the architecture](docs/lead-management-architecture.md). No auth/dashboard, durable abuse protection, request idempotency, encryption-at-rest, backup/restore workflow, retention purge, or deletion controls are implemented. **Expiry is metadata only at this stage**: records are not automatically erased after seven days, and all retained rows count toward the cap. Do not accept real personal information. Database isolation is not authentication against another process running as the same OS user; path checks assume an operator-controlled private directory, not a hostile filesystem.

Synchronous SQLite can briefly block the event loop, including up to the one-second busy timeout; this is a bounded local demonstration. Process-local rate limiting is bypassable by restart and is not sufficient for a public service. No production multi-tenant guarantees are claimed. Contact/name/question content has format/length checks, not a guarantee of accuracy or fictionality. A dropped response after COMMIT can lead to duplicate manual submissions.

Real SlinFish sales capture remains disabled: no such business ID or route exists. No external AI receives inquiries. Any next milestone, deployment, real-data use, migration, or admin/authentication work requires review and separate approval. Nothing is merged into main.
