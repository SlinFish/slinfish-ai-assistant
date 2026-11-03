# Phase AI-2B.2B: bounded topic context

Baseline: `b296250ce9d6e8c1ed7c54cc726214176896e72f`.
Fixture-only commit `c23f1a3` precedes implementation. Its 15 lifecycle scenarios
are frozen in `test/fixtures/topic-context-evaluation.json` with SHA-256:

```text
16f20a46dbb2b77b9630bfa3e603579d65d8fb1cb2a6322a48fc88ad56d9a150
```

## Protocol

`POST /api/chat` still accepts exactly `{business,message}` and returns the
existing JSON. Without context headers it is fully stateless and creates no topic
record. This phase does not change inquiry/admin APIs, schema v3 or provider code.

Opt in with `X-Chat-Context: new` and no sequence header. A successful grounded
answer returns `X-Chat-Context` containing an unpredictable 256-bit base64url
handle, and `X-Chat-Sequence: 1`. Keep these in tab memory only. Continuations send
the handle plus the previous sequence + 1. A single request may use a context at a
time. Busy overlap returns 409 without invalidating the first request. Replayed
or out-of-order sequences invalidate the context. Malformed headers return 400;
missing, expired, revoked or wrong-business handles produce the existing safe
handoff and an empty context header, never a fresh context inferred from history.

Only the exact approved follow-up "What information do you need from me?" (with
existing case/whitespace/final-question-mark normalization) is enabled, and only
for the hotel's last approved booking fact. It repeats that fact verbatim. A new
explicit supported topic replaces the old fact and its permitted follow-up type.
Unknown, mixed, contradictory, sensitive or failed requests invalidate context.
They never establish bookings, payments, availability, inquiry writes or admin
authority. Default demo remains offline; Gemini receives the unchanged static
canonical label and approved knowledge, never a handle, sequence, raw follow-up,
history or topic interpretation metadata.

Reset with `POST /api/chat/reset`, JSON `{business}` and `X-Chat-Context: handle`.
An explicit matching local Origin is required. A syntactically valid request
returns `{reset:true}` without disclosing whether a record existed. It discards
only a matching business's topic. Reset shares the chat rate limiter and existing
JSON byte limits. No CORS permission or new public/admin access is introduced.

## Retention and isolation

Records retain only the random handle, business, fact ID, follow-up type, knowledge
revision, creation/activity times, accepted-turn count, sequence and busy flag.
No messages, dates, contacts, inquiry records or administrator/session data are
retained. Revision is derived from approved facts and follow-up policy; mismatched
revisions fail closed. Limits are three-minute idle, ten-minute absolute, six
accepted turns and 1,000 records per server. Only successful grounded turns renew
idle time; absolute expiry never moves. The sixth answer retires the handle.
Capacity exhaustion returns a safe 503 rather than evicting a live context.
Clock rollback invalidates affected contexts. Expiry is enforced on every access;
a 30-second unreferenced sweep additionally removes idle expired metadata.
Server close/error clears records and timer. Restart preserves nothing.

The browser holds only its own handle/sequence in JavaScript memory, disables
overlapping submissions, and clears the visible conversation and topic on Reset
Conversation or business switching. No localStorage/sessionStorage is used. A
generation check suppresses old answers and releases any handle returned after a
reset. Server completion also rechecks record identity and expiry after awaited
provider work, so reset cannot be undone by an older request. Request sequencing
is local to a context, not administrator authentication.

## Verification and limits

Use Node.js 24.x, fictional data only, no live provider keys:

```sh
AI_PROVIDER=demo GEMINI_API_KEY= AI_API_KEY= node --test test/context.test.js test/context-ui.test.js test/frontend.test.js test/intent.test.js test/retrieval.test.js test/grounded-chat.test.js gemini.test.js diagnostics.test.js
AI_PROVIDER=demo GEMINI_API_KEY= AI_API_KEY= npm test
for file in server.js src/chat.js src/knowledge.js src/context.js public/app.js test/context.test.js test/context-ui.test.js; do
  node --check "$file" || exit
done
git diff --check
```

Tests use a fake clock for expiry/turn boundaries and cover reset, restart,
business isolation, forged/malformed handles, sequence replay, overlapping
requests, reset during mocked provider await, stale browser responses, capacity,
metadata allowlisting and canonical-only provider payloads. The full suite also
retains inquiry/authentication/dashboard/audit regressions. Windows browser
verification is not claimed; UI behavior is checked with an isolated DOM model.

This is one approved contextual relationship, not general conversation memory or
generated answers. Reset delivery is best effort during a network outage: the tab
immediately forgets its handle, while unreachable server metadata expires. A
closed tab similarly abandons its handle until expiry. The DOM displays the
transient conversation; it is not a server transcript. Context is process-local,
has no distributed synchronization, and is not production session infrastructure.

Verified on Linux/Node.js 24.19.0: the focused suite passed 213 tests and the
complete suite (run once) passed 282, both with zero failures or skipped tests.
All seven changed/new JavaScript files passed syntax checks; whitespace checks
passed. All 15 frozen lifecycle scenarios passed. These results do not claim
Windows browser testing or live provider verification.
