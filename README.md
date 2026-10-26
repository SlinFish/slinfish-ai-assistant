# SlinFish AI Business Assistant — local demo inquiry management

A rules-based demonstration for four **fictional** businesses. Node.js **24.x** is required (tested with 24.19.0; see `.node-version`) for built-in `node:sqlite`. No third-party packages, paid APIs, database account, deployment or API keys are needed.

This branch starts from main independently of Gemini PR #1. It includes no Gemini, OpenRouter, AI provider requests, real SlinFish sales capture or notifications. **Use fictional test data only. Do not expose this milestone publicly or use it for real customers.**

## Defaults and configuration

```sh
npm test
npm start
```

The server binds to **127.0.0.1** only. Default `PORT` is 3000. Without `INQUIRY_DB_PATH`, inquiries are validated but not saved: HTTP 200 returns `stored: false` and an explicit message. No database or in-memory substitute is created. Importing server modules does not open a database.

To enable local persistence, set `INQUIRY_DB_PATH` to an **absolute file path in an existing private directory outside the entire checkout**. The file need not exist; it is created with owner-only permissions on POSIX. The parent must have no group/other permissions on POSIX. Existing database files must be private regular files with one hard link; symlinks and shared permissions are rejected. On Windows, protect the directory with NTFS ACLs as shown below; Node's POSIX mode bits cannot establish Windows ACL privacy.

Relative paths, `:memory:`, SQLite URI paths, paths in the checkout/public tree (including resolved symlinks), corrupt databases, unknown schema versions and non-demo database identities fail startup. They do **not** cause validation-only or in-memory fallback. A generic startup error is printed without paths, request data or SQLite details. Unset configuration and failed configuration are different states.

`INQUIRY_DB_PATH` is read by the executable startup and explicit local administrator bootstrap/reset commands only. `.env.example` documents names; `.env` is not loaded automatically. There are no storage configuration endpoints. Only an operator can change the path. Keep the directory outside other repositories too; Git ignores are a secondary safeguard, not a storage boundary. Do not include the directory in development-environment publication snapshots, source archives or build artifacts.

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

SQLite uses schema version **3** (`PRAGMA user_version`), an application identifier and `fictional-demo` realm metadata. STRICT tables, constraints, prepared values, WAL mode and a bounded busy timeout protect integrity. Existing version 1 databases receive the administrator migration, then version 2 databases receive the additive management migration. No inquiry rows are rebuilt or deleted. Existing fields and credentials are preserved; unknown versions and wrong realms fail closed. Before upgrading, stop writers and make a private consistent backup; do not copy just the main file while WAL is active. Older application commits cannot open schema 3.

The new `workflow_status` is authoritative for management. The original `status` column remains a preserved legacy field. Existing new/contacted/qualified values are copied; old closed records become `legacy_closed` in the API until explicitly classified won/lost. No historical outcome is guessed. A new scoped status-event table records previous/new state, administrator ID, time and resulting version atomically with each update. See [the migration, workflow and API contract](docs/lead-dashboard-api.md).

The database has a **200-inquiry cap**. At capacity or a write/lock/storage failure, the endpoint returns sanitized HTTP 503 and does not claim success, overwrite earlier inquiries, or switch stores. HTTP 400/413/415 cover invalid fields/JSON, oversized bodies, and unsupported media types; HTTP 403 rejects cross-origin browser submissions.

Submission limits apply before parsing both valid and invalid inquiry attempts: **5 per socket IP per minute**, **50 per process per minute**, with at most 1000 active client entries. HTTP 429 includes `Retry-After`. Forwarded-IP headers are ignored. Limiter state is short-lived in memory and resets on restart; it is not distributed and shared/NAT users share a bucket. The app does not log submission bodies or contact data.

`GET /api/businesses`, rules-based `POST /api/chat`, and the existing public page/assets remain. Inquiry listing, details, history and status changes require administrator authentication; there are **no public inquiry-reading, deletion or real-sales routes**. Static files are explicitly allowlisted. CSP/no-store/nosniff headers and textContent rendering reduce accidental exposure. Database files and server modules are not served.


## Local administrator authentication

No administrator exists by default. Starting the app, running tests, migrations or setting an environment variable never supplies a default passphrase or creates an owner. One local owner is created only by explicitly invoking:

```sh
node scripts/admin-bootstrap.js
```

Use a private interactive terminal with `INQUIRY_DB_PATH` pointing to the existing private fictional-demo database. The command accepts **no arguments**, no password environment variable and no piped input; stdin/stdout/stderr must be terminals. It prompts twice with echo disabled and terminal history disabled. Choose a unique 16–128-character passphrase (at least 16 non-padding characters). Never put a passphrase in source, shell arguments/history, transcripts, logs or Git. A second setup attempt is rejected before asking for credentials; database constraints also reject concurrent attempts to create a second owner. Failure messages are fixed and do not print paths, hashes, secrets or exceptions. There is no public registration, bootstrap, reset or password-recovery endpoint. Do not delete the inquiry database to reset credentials; use the separate owner-controlled reset command below.

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


## Owner-controlled local administrator passphrase reset

```sh
node scripts/admin-reset.js
```

Reset requires the **existing configured private schema-2 or schema-3 fictional-demo database**, an existing administrator, and interactive stdin/stdout/stderr. It rejects all arguments, piped input and missing/invalid databases before prompting; it does not accept passphrases from environment variables. A mistyped missing file is not created, and an older schema is not migrated by reset. Bootstrap remains one-time and cannot overwrite the owner.

The CLI prompts twice with echo/history disabled and reuses the existing 16–128-character policy and scrypt implementation. Choose a new, different, unique passphrase. Each reset generates a fresh random salt. Credential replacement and revocation of all existing sessions commit in **one SQLite transaction**; a failure rolls both back. Inquiries (including IDs, business scope, status, timestamps, expiry and version), administrator ID/creation time/enabled state, and the existing schema version are preserved. Reset does not create or re-enable an administrator. Future logins also check that the credential snapshot verified by asynchronous scrypt is still current before issuing a session, preventing an in-flight old-password login from surviving reset.

Successful output is only `Local administrator passphrase reset; all sessions revoked.` Failure output is fixed and omits the reason, passphrases, salts, hashes, tokens, database path and exceptions. Exit status is 0 on success and 1 on rejection/failure. There is no password-reset HTTP endpoint, recovery token, email or default password. Tests and terminal smoke checks use only synthetic credentials and temporary databases.

**Owner-control boundary:** recovery does not require knowledge of the old passphrase. Permission to use your Windows account and read/write the protected database effectively grants permission to take over the application administrator. Protect the Windows sign-in, lock the screen, keep the dedicated NTFS directory owner-restricted, and do not share that Windows account. This cannot defend against malware or another process already running as the same OS user, or an OS administrator with filesystem access. Keep SQLite/WAL files and backups private; do not copy them into Git, public folders or cloud environment snapshots. Restoring an old backup may restore old credential/session state: perform a reset against the restored database before allowing login, and reconcile inquiry deletion/retention separately. JavaScript cannot guarantee erasure of transient passphrase strings, and SQLite/WAL/backups may retain historical hashes. No forensic-erasure claim is made.

### Windows PowerShell reset and verification

Use a private Windows Terminal at the repository root with Node 24.x. Disable transcripts, terminal recording and verbose/debug HTTP tracing. Do not put passphrases in shell commands, arguments, environment variables or files. Windows execution is not verified here; masking and reset behavior were checked using a Linux PTY with synthetic credentials, and the temporary database was removed.

**Optional full before/after verification:** if you still know the old passphrase, define this function in a second PowerShell terminal while the current server is running. It prompts securely, never prints response bodies or cookie values, and asserts only the expected login status. If the passphrase was forgotten, skip the old-password steps; the reset command never needs it.

```powershell
$origin = 'http://127.0.0.1:3000'
function Confirm-PrivateAdminLogin {
    param([string]$Prompt, $Session, [int]$ExpectedStatus)
    $securePass = Read-Host $Prompt -AsSecureString
    $loginBody = $null
    $result = $null
    $status = 0
    try {
        $loginBody = @{ password = ([System.Net.NetworkCredential]::new('', $securePass)).Password } | ConvertTo-Json -Compress
        $result = Invoke-RestMethod -Uri "$origin/api/admin/login" -Method Post -ContentType 'application/json; charset=utf-8' -Headers @{ Origin = $origin } -WebSession $Session -Body $loginBody
        if ($result.authenticated -ne $true) { throw 'Invalid authentication response.' }
        $status = 200
    } catch {
        if ($null -ne $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) { $status = 401 }
        else { throw 'Authentication verification failed; do not dump request data.' }
    } finally {
        $loginBody = $null
        $result = $null
        $securePass.Dispose()
        $securePass = $null
    }
    if ($status -ne $ExpectedStatus) { throw 'Unexpected authentication result.' }
}
# Optional: keep this session in this terminal to verify server-side revocation.
$beforeResetSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Confirm-PrivateAdminLogin -Prompt 'Current passphrase (before reset)' -Session $beforeResetSession -ExpectedStatus 200
```

In the **server terminal**, stop the application with Ctrl+C. Keep the same protected database; do not delete or replace it. Run:

```powershell
$env:INQUIRY_DB_PATH = Join-Path (Join-Path $env:LOCALAPPDATA 'SlinFishDemo') 'inquiries.sqlite'
if (-not (Test-Path -LiteralPath $env:INQUIRY_DB_PATH -PathType Leaf)) { throw 'Existing demo database required.' }
node scripts/admin-reset.js
if ($LASTEXITCODE -ne 0) { throw 'Local reset was rejected or failed; no success was confirmed.' }
# Enter the NEW passphrase twice at the masked prompts, not in these commands.
$env:PORT = '3000'
npm.cmd start
```

In the **verification terminal**, keep the same origin/port. If you performed the optional before-reset login, first check its cookie is now rejected and the old passphrase no longer works:

```powershell
$revoked = $false
try {
    Invoke-RestMethod -Uri "$origin/api/admin/session" -Method Get -Headers @{ Origin = $origin } -WebSession $beforeResetSession | Out-Null
} catch {
    if ($null -ne $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) { $revoked = $true }
    else { throw 'Session revocation verification failed.' }
}
if (-not $revoked) { throw 'Old session was unexpectedly accepted.' }
$oldPasswordSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Confirm-PrivateAdminLogin -Prompt 'Previous passphrase (must now be rejected)' -Session $oldPasswordSession -ExpectedStatus 401
$beforeResetSession = $null
$oldPasswordSession = $null
```

Then verify the new passphrase and log out. If you skipped the optional old-password checks, define the function above without its final optional login call, then run this block:

```powershell
$newSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Confirm-PrivateAdminLogin -Prompt 'NEW administrator passphrase' -Session $newSession -ExpectedStatus 200
$state = Invoke-RestMethod -Uri "$origin/api/admin/session" -Method Get -Headers @{ Origin = $origin } -WebSession $newSession
if ($state.authenticated -ne $true) { throw 'New session verification failed.' }
$logoutHeaders = @{ Origin = $origin; 'X-CSRF-Token' = $state.csrfToken }
Invoke-RestMethod -Uri "$origin/api/admin/logout" -Method Post -ContentType 'application/json; charset=utf-8' -Headers $logoutHeaders -WebSession $newSession -Body '{}' | Out-Null
$state = $null
$logoutHeaders = $null
$newSession = $null
Write-Host 'New administrator login/session/logout verified.'
```

Do not print the web-session objects, passphrase bodies, headers or CSRF values. Clearing variables limits accidental reuse but does not guarantee secret erasure from process memory. A successful new login revokes prior sessions normally; the old-password failure check must happen first. Automated tests separately compare complete inquiry rows before/after reset and inject a revocation failure to verify transactional rollback. Reset does not implement inquiry deletion or backups; it is independent of the dashboard.

## Current limits and next review

Inquiry persistence, one-owner authentication, sessions and the local dashboard are implemented. Durable abuse protection, request idempotency, encryption-at-rest, backup/restore workflows, retention purge and inquiry deletion controls remain unimplemented. **Expiry is metadata only at this stage**: records are not automatically erased after seven days, and all retained rows count toward the cap. Do not accept real personal information. Database isolation is not authentication against another process running as the same OS user; path checks assume an operator-controlled private directory, not a hostile filesystem.

Synchronous SQLite can briefly block the event loop, including up to the one-second busy timeout; this is a bounded local demonstration. Process-local rate limiting is bypassable by restart and is not sufficient for a public service. No production multi-tenant guarantees are claimed. Contact/name/question content has format/length checks, not a guarantee of accuracy or fictionality. A dropped response after COMMIT can lead to duplicate manual submissions.

Real SlinFish sales capture remains disabled: no such business ID or route exists. No external AI receives inquiries. Any next milestone, deployment, real-data use or further migration requires review and separate approval. Nothing is merged into main.

## Local administrator dashboard (Task 2D)

After configuring the private database and explicitly bootstrapping the owner as above, open **http://127.0.0.1:3000/admin**. Unauthenticated requests redirect to `/admin/login`. Both pages and their assets enforce the existing loopback/Host/Origin checks; pages embed no inquiry records. The browser obtains records only through authenticated, no-store APIs. Without configured storage or an owner, sign-in fails safely; no account is created automatically.

Filter by business and status, page through newest inquiries, open details, review allowed next statuses and update. The workflow is `new → contacted → qualified → won/lost`, with explicit lost and reopen paths in [the API contract](docs/lead-dashboard-api.md). Every write checks the observed version, CSRF token, origin and live session inside the transaction. A stale write returns 409; the UI reloads details for review and never retries a mutation automatically. Status history is paginated. At 10000 audit events further writes fail safely without deleting history.

Passphrases are cleared from the login field immediately; CSRF state stays in memory. Submitted text uses `textContent`, never HTML interpolation. Loading, empty, safe-error and session-expired states are provided. Visible labels, table headers/caption, focus indicators, keyboard controls and responsive scrolling support accessibility. Logout, session expiry and page departure clear displayed inquiry data; late responses cannot restore it. Client expiry uses server metadata and never extends the server deadline. Browser/OS owners can still inspect process memory; these controls do not secure a compromised machine. Avoid shared browser profiles, screenshots and session recording.

### Exact Windows PowerShell dashboard verification

Run the complete test/syntax/whitespace commands in the earlier verification section. Use Node 24.x. Stop the server and privately back up any existing database before the first schema-3 startup. In a private interactive PowerShell console at the repository root:

```powershell
$env:INQUIRY_DB_PATH = Join-Path $env:LOCALAPPDATA 'SlinFishDemo\inquiries.sqlite'
# Use the protected directory/ACL setup above first if this is a new installation.
# Run ONLY if no administrator exists; never pass a password as an argument.
node scripts/admin-bootstrap.js
# Existing owners skip bootstrap. It intentionally rejects a second owner.
$env:PORT = '3000'
npm.cmd start
```

In a second private PowerShell console, open the interface:

```powershell
Start-Process 'http://127.0.0.1:3000/admin'
```

Sign in using the existing owner passphrase. Check keyboard navigation, filter/empty states, detail focus, mobile-width scrolling, allowed transitions and history. Sign out and confirm details disappear and `/admin` requires sign-in. Do not use real contacts. Browser accessibility and Windows ACLs require manual review; automated checks here ran on Linux.

For an HTTP verification using **one newly submitted fictional record only**, run this in that second terminal without transcription, verbose HTTP debugging or printing session objects. The passphrase is prompted securely, kept transiently in memory for the local login, and never placed in command history:

```powershell
$origin = 'http://127.0.0.1:3000'
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$secure = Read-Host 'Existing local administrator passphrase' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $loginBody = @{ password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } | ConvertTo-Json -Compress
    $auth = Invoke-RestMethod "$origin/api/admin/login" -Method Post -WebSession $session -ContentType 'application/json' -Headers @{ Origin = $origin } -Body $loginBody
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    Remove-Variable loginBody,secure,ptr -ErrorAction SilentlyContinue
}
$fixture = @{ business = 'hotel'; name = 'Fictional Dashboard Tester'; contact = 'dashboard@example.invalid'; question = 'Fictional dashboard verification only'; consent = $true } | ConvertTo-Json
$receipt = Invoke-RestMethod "$origin/api/lead" -Method Post -ContentType 'application/json' -Headers @{ Origin = $origin } -Body $fixture
if (-not $receipt.stored) { throw 'Local storage is not enabled.' }
$path = "$origin/api/admin/businesses/hotel/inquiries/$($receipt.inquiryId)"
$page = Invoke-RestMethod "$origin/api/admin/inquiries?business=hotel&status=new" -WebSession $session
if (-not ($page.inquiries | Where-Object { $_.id -eq $receipt.inquiryId })) { throw 'New inquiry was not listed.' }
$detail = Invoke-RestMethod $path -WebSession $session
$headers = @{ Origin = $origin; 'X-CSRF-Token' = $auth.csrfToken }
$change = @{ status = 'contacted'; version = $detail.version } | ConvertTo-Json
$updated = Invoke-RestMethod $path -Method Patch -WebSession $session -ContentType 'application/json' -Headers $headers -Body $change
if ($updated.status -ne 'contacted' -or $updated.version -ne ($detail.version + 1)) { throw 'Status update failed.' }
try {
    $null = Invoke-RestMethod $path -Method Patch -WebSession $session -ContentType 'application/json' -Headers $headers -Body $change
    throw 'Stale update unexpectedly succeeded.'
} catch {
    if ($null -eq $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 409) { throw 'Expected HTTP 409 for stale version.' }
}
$audit = Invoke-RestMethod "$path/history" -WebSession $session
if ($audit.events.Count -ne 1 -or $audit.events[0].previousStatus -ne 'new' -or $audit.events[0].status -ne 'contacted') { throw 'Audit verification failed.' }
$null = Invoke-RestMethod "$origin/api/admin/logout" -Method Post -WebSession $session -ContentType 'application/json' -Headers $headers -Body '{}'
Remove-Variable session,auth,headers,detail,updated,page,audit,change,fixture,receipt,path -ErrorAction SilentlyContinue
Write-Output 'Fictional dashboard HTTP verification passed.'
```

This deliberately retains the synthetic inquiry and its audit record; no deletion endpoint exists. Logging in from PowerShell revokes an earlier browser session, so sign in again in the browser afterwards. Do not print credentials, cookies or CSRF tokens. This example assumes the new record appears in the first 25 matching inquiries; refresh/filter in the UI if the local database has many records.

Recommended follow-up: manual Windows/browser/accessibility review, owner-approved private backup/restore and retention/deletion controls, then a separately reviewed abuse/privacy model before considering real data or any deployment. The audit is not tamper-proof against the database owner; there are no separate business roles or additional administrators. This local demonstration is not production-ready.
