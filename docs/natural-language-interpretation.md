# Phase AI-2B.2A: conservative local interpretation

Baseline: `15737624837d8d8558eceb3be90c2142bb631f0a`.
The fixture-only commit `6ebb36db5f2ec4ebb8881a85ce8c4ff91b468fb0`
precedes implementation. Its 16 supported examples cover all eight facts and
four businesses; its 32 negatives cover constraints, mixed requests, negation,
contradictions, cross-business references, injection and private input.

The frozen `test/fixtures/natural-language-evaluation.json` has SHA-256:

```text
eca63a009e9d04c52b8bd76df712f61d40bae41cecc4391a6f09409ea0dab9a4
```

## Behavior

The existing exact-alias/reviewed-grammar matcher is unchanged and remains the
fast path. Only an uncovered match enters `src/intent.js`; invalid or ambiguous
fast-path input cannot be rescued by interpretation.

The fallback accounts for every clause. It recognizes reviewed greetings,
business-specific statements of interest, and conversational question wrappers.
Question operators and domain objects must describe one supported intention.
Unrecognized clauses, a second request, additional conditions, or negation cause
the existing safe handoff. A background clause ending in a question mark is not
silently treated as a harmless statement. Repeated punctuation is rejected rather
than discarded. No arbitrary prefix, unknown word, number or symbol is removed.

For example, "Hi, I'm planning to stay at your hotel next week. Could you tell me
what time I can check in?" selects the original sample check-in fact. Next week is
a statement of the customer's plan, not confirmed availability. "I'm coming next
week. Can you guarantee early check-in?" and "What time is check-in, and is
breakfast included?" safely hand off.

Interpretation returns only a local fact ID and a fixed reason. Approved answer
texts and sources are unchanged. Gemini still receives only the original static
canonical label and approved knowledge through its unchanged adapter, when
explicitly configured; raw messages and interpretation metadata are not sent.
Offline demo performs no provider requests.

No memory, context transport, reset endpoint, new API fields, schema change,
administrator change, inquiry change, dependency or deployment is included.
"What information do you need from me?" remains unsupported after a booking
answer because conversational memory is intentionally outside this phase.

## Verification

On Linux with Node.js 24.19.0, use:

```sh
AI_PROVIDER=demo GEMINI_API_KEY= AI_API_KEY= node --test test/intent.test.js test/retrieval.test.js test/grounded-chat.test.js gemini.test.js diagnostics.test.js
AI_PROVIDER=demo GEMINI_API_KEY= AI_API_KEY= npm test
for file in src/chat.js src/intent.js test/intent.test.js; do
  node --check "$file" || exit
done
git diff --check
```

Tests verify fixture integrity, exact fact text and sources, clause ordering,
unknown constraints, input bounds, cross-business isolation, unchanged HTTP JSON,
absence of memory, and canonical-only provider payloads using mocks. The previous
AI-2B.1 frozen fixture and original FAQ aliases are retained without edits.
The complete suite is run once at completion. No live provider calls or Windows
testing are part of this verification.

Final results: focused suite 186 passed; complete suite 258 passed. Both had zero
failures, cancellations or skips. All three changed/new JavaScript files passed
syntax checks, and `git diff --check` passed. The frozen supported cases scored
16/16, and all 32 negative cases safely handed off. The original evaluation
retained 80/80 correct paraphrases and 92/92 safe negative outcomes.

## Limitations

This is a reviewed English clause grammar, not unrestricted semantic understanding.
Unknown background, unreviewed conversational phrasing, punctuation, numeric
dates, languages and typos may still safely refuse. The only date phrase admitted
as background here is "next week" in the reviewed hotel plan statement; dates
attached to requests do not establish availability. Multiple questions hand off
even if they concern the same fact. Passing this development fixture does not
establish general language coverage or universal adversarial resistance.
