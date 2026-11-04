# Local administrator inquiry-management contract

This contract applies only to the protected fictional-demo database on loopback. No public/customer listing, sales capture, deletion, deployment or external service is introduced.

## Schema version 3 (additive)

Version 1 first receives the existing additive administrator migration to version 2. Version 2 then receives, in one transaction:

- `inquiries.workflow_status`: authoritative management status, default `new`, with checks allowing `new`, `contacted`, `qualified`, `won`, `lost`. A null value is permitted only for a preserved legacy `status='closed'` row.
- Existing new/contacted/qualified values are copied into the new field. Existing closed records retain all legacy fields and use null in the new field; the API labels these `legacy_closed`. No won/lost outcome or audit history is invented.
- A unique business/ID index supports a composite foreign key from the new `inquiry_status_events` table.
- Status events contain a sequence ID, scoped inquiry ID, local administrator ID, previous/new status, server timestamp and resulting inquiry version. Event insertion and status/version update are transactional. No contact/question copies, session tokens, salts or hashes enter the audit table.

No tables or inquiry rows are dropped/rebuilt. IDs, business scope, submitted fields, timestamps, expiry and versions are unchanged by migration. The old `status` field remains a preserved legacy field; management reads/writes use `workflow_status`. Read management status through the new API or explicitly inspect the new field, not the legacy field. Authentication credentials and sessions are preserved. Reset supports existing schema 2 or 3 without running migrations; ordinary application startup upgrades to 3. Unknown versions and wrong realms fail closed. Back up privately and stop writers before upgrade; older application commits cannot open the newer schema.

## Explicit transitions

| Current state | Allowed next states                            |
| ------------- | ---------------------------------------------- |
| new           | contacted, lost                                |
| contacted     | qualified, lost                                |
| qualified     | contacted, won, lost                           |
| won           | qualified (reopen for review)                  |
| lost          | contacted (reopen)                             |
| legacy_closed | won, lost (explicit historical classification) |

A no-op or other transition is rejected. Legacy closed is a compatibility label, not a new selectable workflow target. Updates never extend inquiry retention. Current statuses are returned as `status` in API DTOs.

## Protected endpoints

All endpoints reuse the local-peer/Host checks, origin-bound session cookies and expiry checks. GETs accept no Origin or an exact same Origin; PATCH requires exact Origin, JSON and `X-CSRF-Token`. Responses are no-store. Every successful data operation renews idle time only and returns `X-Admin-Session-Expires` (epoch milliseconds), bounded by the original absolute session expiry. It is metadata, not an authentication credential.

- `GET /api/admin/inquiries`: optional `business`, `status`, `limit` (1–50, default 25), and opaque `cursor`. Reject duplicate/unknown parameters, unknown business IDs and invalid status/cursor values. Owner can view the four fictional businesses. Sort by creation time DESC and UUID DESC for ties. Return `{inquiries,nextCursor}`. Summaries include ID, business identity/type, name, contact, status, creation/update timestamps and version; question text is in details only. Empty results return an empty list. Filtering while paging is the caller's responsibility; cursor is a validated position, never an authorization grant or frozen snapshot.
- `GET /api/admin/businesses/:business/inquiries/:id`: scoped detail, question, expiry, allowed next statuses and the newest history page. Unknown/out-of-scope IDs return the same 404. No unscoped detail endpoint.
- `GET /api/admin/businesses/:business/inquiries/:id/history`: optional positive integer `before` cursor. Return `{events,nextCursor}`, newest sequence first, up to 50 per page. All retained events are accessible by paging.
- `PATCH /api/admin/businesses/:business/inquiries/:id`: body exactly `{status,version}` with an allowed status and positive safe-integer observed version. Recheck the live session inside the write transaction; client-supplied actors/business metadata are never accepted. Return fresh detail on success. The transaction increments version exactly once and appends exactly one event. SQL values are parameterized.

HTTP 401 means absent/expired/revoked session. HTTP 403 means failed local Origin/Host/CSRF checks. HTTP 400 means invalid filters, body or transition. HTTP 404 means no inquiry in the requested business. HTTP 409 means the observed version is stale; reload and review, never blindly retry the update. HTTP 500 is a sanitized internal failure. Audit capacity is 10000 events per database; at capacity status updates fail with HTTP 503 rather than deleting historical data. Existing 200-inquiry cap still applies.

The owner is the sole administrator and can access all four demo businesses. Business-scoped paths/queries prevent cross-business record confusion; this is not a multi-user tenant-permission system. SQLite history is application-managed, not tamper-proof against the OS/database owner. There are no DELETE endpoints, audit-edit endpoints, CSV exports or paid tools.
