# Phase AI-2B.1: local grounded retrieval

This phase adds local English question interpretation, not answer generation,
multiple-fact answers, conversation context, or new Gemini behavior. All answers
still use the eight original approved FAQ texts. The HTTP request and response
contracts, inquiry system, administrator interface and schema v3 are unchanged.

## Evaluation provenance

The fixture-only commit `e21c486c580be247c4aa5690b314bcb89a50c114` precedes the
matcher implementation and is based on `1f43601`. The frozen file is
`test/fixtures/retrieval-evaluation.json`. Its SHA-256 is:

```text
1b6e6c876cc132001f1872959f0019fee6440a25969252ccf9235fd4507e2b94
```

It contains 80 English paraphrases (ten per approved fact), 60 unsupported,
ambiguous or constrained questions, 16 cross-business questions and 16 adversarial
questions. Negative cases require the existing safe handoff with empty sources.
Tests check the fixture bytes and report paraphrase misses individually. These
fixtures are a fixed development evaluation, not an independent blind benchmark.
Changes to grammar must not rewrite them to improve a reported score.

Baseline `1f43601` answered 0/80 of these additional paraphrases and safely handed
off 92/92 negative cases. The implemented matcher answers 80/80 with no incorrect
facts and safely hands off 92/92 negatives. Every answer is checked against its
original approved text and business-scoped source. Additional tests cover
compositional grammar combinations and unsupported clauses added to all 80
paraphrases; success on this finite set is not proof of unrestricted language
understanding or universal attack resistance.

## Matching and coverage

`src/retrieval.js` defines reviewed grammatical question frames and domain-specific
synonyms. For example, request frames combine first-person pronouns, modal verbs,
request verbs, and viewing/property-visit noun phrases. Patterns are compiled once,
anchored to the entire question, immutable and non-stateful. They never interpolate
untrusted text into a regular expression. A question must map to exactly one fact.

Internal metadata includes scoped fact IDs, supported intents, synonym grammar,
qualifiers, coverage descriptions and exclusions. Full-question grammar enforces
coverage: descriptive exclusion metadata is not a substitute for reviewing new
patterns. Unknown words or extra constraints cannot simply be removed to make a
match. Negation, early/late requests, prices, guarantees, specific products,
unrecognized entities and additional requests fail closed unless an entire
reviewed pattern covers them. The original exact FAQ aliases remain supported.

The matcher validates the existing 1000-code-unit input bound and text rules. It
normalizes case and whitespace, one final question mark or period, and the
reviewed check-in/check in spelling variation. It does not transliterate or strip
arbitrary symbols. ASCII English grammar, unknown punctuation, numbers and
non-English text are intentionally conservative: unsupported input hands off.

`retrieveLocalKnowledge()` exposes an immutable snapshot for the selected business
only. Local interpretation metadata is excluded from `retrieveKnowledge()`, which
retains the original provider knowledge shape. The chat handler passes the same
canonical FAQ label as before to the unchanged Gemini adapter when explicitly
configured by an operator. Raw paraphrases, private free-form text, credentials,
records and contacts do not become provider input. Demo mode makes no requests.

## Verification commands

Use the supported Node.js 24.x runtime. On Linux, with Gemini disabled:

```sh
AI_PROVIDER=demo GEMINI_API_KEY= AI_API_KEY= npm test
AI_PROVIDER=demo GEMINI_API_KEY= AI_API_KEY= node --test test/retrieval.test.js test/grounded-chat.test.js gemini.test.js diagnostics.test.js
for file in src/chat.js src/knowledge.js src/retrieval.js test/retrieval.test.js; do
  node --check "$file" || exit
done
git diff --check
```

Provider tests inject mocked responses; no live provider calls or keys are needed.
The full suite also verifies private temporary SQLite databases, migrations,
persistence, authentication, CSRF, session expiry, dashboard operations and audit
history. No storage, schema or administrator implementation changes are included.

Verification on Linux with Node.js 24.19.0: the full suite passed 204 tests
(including all 103 existing tests); the focused suite passed 132 tests. Both runs
had zero failures, cancellations or skipped tests. All four changed/new JavaScript
files passed syntax checks, and formatting and whitespace checks passed. The
focused tests are a subset of the full suite, not additional independent tests.

## Manual Windows verification (not executed on Windows)

In a fresh PowerShell terminal at the checkout root, verify Node 24.x and select
demo mode for this process. No real customer data or provider key is needed.

```powershell
node --version
$env:AI_PROVIDER = 'demo'
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
node --test test/retrieval.test.js test/grounded-chat.test.js gemini.test.js diagnostics.test.js
if ($LASTEXITCODE -ne 0) { throw 'Focused tests failed.' }
foreach ($file in @('src/chat.js', 'src/knowledge.js', 'src/retrieval.js', 'test/retrieval.test.js')) {
    node --check $file
    if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $file" }
}
git diff --check
```

Record the actual Windows pass/fail/skip totals. The pre-existing POSIX permission
test skips on Windows; Windows ACL privacy still requires separate manual review.
SQLite experimental notices are distinct from failed assertions.

For a browser smoke check, use an unconfigured validation-only demo in this fresh
terminal (`Remove-Item Env:INQUIRY_DB_PATH -ErrorAction SilentlyContinue`), run
`npm.cmd start`, and open `http://127.0.0.1:3000`. Select Hospitality. Verify that
"When can we arrive to check in?" returns the original sample 2 PM answer, and
"How do I reserve a room?" returns the staff-confirmation booking instructions.
"Can I check in early?", "Is breakfast included?", a guaranteed room/price request,
and a question about another business must safely hand off. Switch businesses and
confirm the selected FAQ is used. Use fictional values only for any inquiry check.
Stop the process afterward; no deployment or real bookings are involved.

## Known limits

- This is a finite reviewed grammar, not general semantic search. Unsupported
  phrasing, punctuation, typos and languages can yield safe false negatives.
- Multiple-fact requests and short follow-ups still hand off; no chat history is
  saved. Requests for specific dates, rates, policies or availability are not
  answered by a merely similar keyword.
- Knowledge coverage remains eight fictional facts. The matcher cannot add
  information, confirm availability, book appointments or notify staff.
- Gemini model availability remains unverified and outside this phase. Its
  implementation and configuration are unchanged; verification uses mocks only.
- The existing public-page AI disclosure and UI concurrency limitations remain
  outside this retrieval-only phase.
