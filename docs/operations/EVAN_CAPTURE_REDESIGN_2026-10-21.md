# Evan capture redesign — local checkpoint

Status: implemented locally and boundary-tested; **not approved for live retesting or production**.

Current direction: following the James implementation review, the user approved adapting deterministic source-bound capture instead of enabling the optional cloud extractor. The shared `evan_capture_v2` record, event arbitration, planner and email projections remain. Enabled rehearsal capture now defaults to local code, with no model or API key. Production remains disabled. The actual local development-corpus evaluation is recorded separately in `work/evan-6097-promotion/capture-evaluation/local-development-20261021-001.json`; it exposed material semantic gaps and is **not a readiness pass**. Holdout remains untouched. See `EVAN_JAMES_CAPTURE_REUSE_2026-10-21.md` for the follow-up checkpoint when complete.

The sections below record the earlier cloud-adapter proposal and its boundary tests, not an instruction to enable that provider or a description of the current default engine. Earlier test counts and statements that actual extraction was unmeasured are historical.

## Plain-English finding

The recurring omissions were not simply failures to describe the desired behavior. The old planner recognized a finite collection of wording patterns, while email summaries could independently interpret the transcript again. Adding another furniture word or another way of saying a name repaired an example, not the underlying limit. Separate interpretations could also disagree or restore something the caller had removed.

This redesign gives capture its own contract. It produces a current, evidence-backed move record, and the planner and email templates read that format instead of maintaining separate lists of recognized phrases. It is deliberately separate from Evan's voice, questions, tools, and farewell controls.

This is **not** proof that a model will understand every caller. Moving interpretation to a structured extractor removes a vocabulary bottleneck; it does not remove interpretation risk. Source quotes prove where words came from, not that a negative sentence, responsibility, or correction was understood correctly.

## Boundaries honored

- Evaluate acknowledged the live-testing hold. No new call was started.
- No Vercel deployment, promotion, alias, environment-variable change, or production write was made for this redesign.
- Evan's Anam candidate prompt, Qwen model, voice, knowledge, tool configuration, and audio routing were not changed by this redesign. Earlier worktree changes remain preserved.
- Other agents do not receive capture flags, and the capture endpoint requires the exact active Evan persona, variant, session, launch, browser owner, and trusted origin.
- `EVAN_CAPTURE_ENABLED` defaults off and is hard-disabled when `VERCEL_ENV=production`.
- Rob selected **local-only verification**. No external model evaluation was completed. The initial synthetic probe failed before producing a provider result; its escalation was rejected, and no retry was made after Rob's decision. No model accuracy or latency result is claimed.
- The OpenAI capture adapter remains unconfigured and disabled in deployed environments. No API key was created, copied, or scoped to another environment.

## What changed

| Area | New behavior | What it does not authorize |
| --- | --- | --- |
| Capture contract | Arbitrary user-supplied names, items, quantities, route stops, services, timing, access, packing, contact preferences, and uncertainties, each with user-turn evidence | Invented details, bookings, prices, confirmation or consent |
| Current state | Full bounded snapshots; later corrections/removals win; conflicting same-turn singleton data rejects rather than depending on array order | Merging every historic mention into current scope |
| Route identity | Separate city, address, purpose, and stated visit order; same-city stops stay distinct; stale geocodes cannot cross a corrected city/address | Model-created coordinates or street confirmation |
| Live updates | Completed utterances only; debounced serial work; newer revisions invalidate older responses; bounded session-binding and request waits | Blocking Evan's speech or keeping a call open for capture |
| Failure display | Retain last good data with explicit updating/delayed status; an empty capture stays empty | Silent fallback to keyword guesses or pretending old notes are current |
| Email content | One finalized record is reused for Admin, Sales and visitor templates; current contact facts replace stale fields | Changing recipients or sending mail based on model instructions |
| Capture failure at close | Three-message workflow can continue with an explicit summary-unavailable/manual-review notice; internal sanitized transcript is available | Guessing a complete summary from the old parser |
| Late changes | Deterministic email-refusal scan and internal transcript sanitization cover the full existing 400-turn bound | Ignoring a refusal after turn 200 |
| Diagnostics | Revision, source count, fact count, elapsed time and safe error code; finalized email attempt records capture status and transcript digest | Logging transcripts, contact values, API keys, or model response bodies |

### Live versus final authority

The live record is ephemeral browser-session data. It is not trusted as authority to email anyone. At close, the existing provider-final transcript and receipt hash must match; a fresh finalized capture is derived from that source and reused by all email audiences. If the provider transcript differs from the browser stream, the final record can legitimately differ from what was last visible. This is shared interpretation and projection logic, not a promise of byte-identical independent model calls.

The existing check-in/deterministic spoken-address rules still choose delivery recipients. Captured contact is display/summary data; it cannot reroute an email. A spoken alternate email does not replace a private check-in address. A model cannot authorize a send, callback, or hangup.

### Bounds and deployment gate

The candidate adapter accepts up to 400 completed turns, 2,000 characters per turn, and 80,000 characters per capture request. Oversized input is rejected, not rolled into a truncated "complete" record. Structured output is limited to 100 facts and eight current route stops. More than eight validated active stops fails explicitly rather than hiding the ninth.

The transport is a separate, non-speaking OpenAI structured-output request. It requires an explicit `EVAN_CAPTURE_MODEL` and existing `OPENAI_API_KEY`; there is no provider/model fallback. The proposed test snapshot is `gpt-5.4-mini-2026-03-17` with reasoning disabled, **not a selected or verified runtime**. No real test validated that choice. Phone/email channels recognized by the masking layer are replaced before the provider request and restored for source validation; this is not a claim of universal PII redaction, and names/other move details can remain in transcript text. No real transcript should be routed through this adapter without the next explicit approval and privacy/configuration review.

## Local verification

| Check | Result |
| --- | --- |
| Existing Evan release/regression suite | 396 passed |
| New capture core, service, client, API, projection and dispatch suites | 71 passed |
| Full repository `npm test` | Passed with normal local filesystem access; sandbox initially blocked Windows temp-directory checks |
| TypeScript | Passed |
| Optimized local Next.js build | Passed with normal local filesystem access; sandbox initially blocked compiler path canonicalization |
| Changed-file ESLint, excluding the shared player | Passed |
| Shared `AnamPlayer.tsx` lint | Existing `react-hooks/set-state-in-effect` finding at session reset; reproduced against unchanged HEAD source, not hidden or broadly refactored |
| Local component-render adapters | Capture ready/updating/degraded/empty behavior, no legacy fact resurrection, route controls and exit controls passed; not a real browser/audio test |

The 71 capture tests use explicit fake provider responses to test grounding, data flow, removal/correction behavior, ownership, failure handling and delivery boundaries. They **do not prove that a real extractor will generate those responses**. No actual email was sent in these tests.

## Varied-transcript evaluation assets

- Corpus: `tests/fixtures/evan-capture-varied-transcripts.json` — 52 synthetic cases, 36 development and 16 holdout, nine prefix checkpoints.
- Runner: `scripts/anam/evaluate-evan-capture.mjs` — offline by default, explicit split/repeat selection, non-overwriting reports, code/schema/corpus hashes, conservative scoring and manual-review flags.
- Plan: `docs/operations/EVAN_CAPTURE_EVALUATION_PLAN.md`.
- Local report: `work/evan-6097-promotion/capture-evaluation/offline-development-20261021-002.json`.

The harness ran 86 development/checkpoint/repeat executions with a deliberately empty mocked provider, zero execution errors, 13 scorer self-checks and four hand-authored shared-record projection checks. Its missing-fact scores are intentional negative-control results, **not new extractor performance**. Holdout has not been executed or exposed to the implementation author.

Independent review found a scorer defect that gave false credit when packing responsibility was reversed. That was corrected before any real evaluation. This matters: a reassuring score is only useful when the scorer can detect the failures we care about.

## What remains before another live test

1. Decide and authorize how actual extraction will be evaluated. Under the present local-only limit, semantic accuracy and real latency remain unmeasured. A local model would require its own explicit setup and evaluation; this implementation does not silently substitute one.
2. Evaluate real outputs on development transcripts, inspect false positives and omissions, and fix general representation/interpretation problems rather than adding fixture-specific words.
3. Freeze code, model/configuration, schema, corpus and scorer; run the untouched holdout once. Preserve failures and require manual semantic review where the scorer is uncertain.
4. Only after those gates pass, explicitly enable a protected rehearsal preview, verify both entry modes and capture authorization, then hand Evaluate that exact build for scoped live testing.
5. Repeat the same live scenario on the same version before expanding scenarios. Production requires a separate release decision.

No claim of "consistent for any and all calls," a measured success percentage, or live-test readiness is justified at this checkpoint.

## Reusable lessons for other X Agents

1. **One fact contract, many views.** A dashboard, brief, email and CRM payload should not each independently extract the same customer facts.
2. **Separate understanding from action.** A model may propose grounded facts; deterministic ownership, recipient, send and close rules remain in control.
3. **Treat corrections as first-class behavior.** Test replacement, removal, reinstatement, uncertainty, aliases and different entities with similar names—not just first mentions.
4. **Test negative examples alongside positives.** "Do you pack pianos?" is not "I'm moving a piano." "My brother's email" is not automatically the caller's address.
5. **Test the event path, not just a helper.** Completed versus partial speech, repeated events, late replies, session binding, timeouts and teardown can defeat a correct extractor.
6. **Keep evidence levels separate.** Unit checks, mocked integration, real transcript extraction, rendered browser behavior and live conversation each establish different things.
7. **Preserve a clean holdout and an honest scoreboard.** Unknown cases and unresolved semantic judgments must not disappear from denominators. Empty stable output is not reliable capture.
8. **Do not generalize this redesign to Amy, Dani or James yet.** Use their own representative transcripts and permissions. This work provides a pattern and tests, not proof of their behavior.

## Reference guidance

[OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat) explains strict schema output. The implementation still validates provenance and separates structural validity from semantic correctness. [The proposed model's official reference](https://developers.openai.com/api/docs/models/gpt-5.4-mini) documents structured-output and reasoning support; it is not evidence that it performs adequately for Evan.

The React review kept capture asynchronous and cancellable, guarded unmount before initialization, preserved shared-agent behavior, and avoided broad lifecycle changes merely to eliminate a baseline lint warning.

## Independent-review follow-up — 2026-10-21

Three independent Astra reviewers examined fact/state invariants, actual player-event wiring, and the scorer. Their synthetic probes exposed failures the earlier passing tests did not cover. Those failures were reproduced locally before repair; no new live call was needed to find them.

| Failure pattern | General repair | Local evidence |
| --- | --- | --- |
| Late old user partial flushed newer unfinished speech; an expanded old final became the newest turn | Retain user message identity, ignore old partials, and revise the original source slot without new speech/close/VAD authority | Actual player callbacks executed with the real accumulator/client; contact, capture and planner histories stay aligned; close freshness and route side effects remain unchanged |
| Identical item groups at different stops collapsed | Required literal, source-grounded `scope` in contract v2; preserve scope and endpoint labels in projections | Separate same-role groups, targeted count changes/removal/reinstatement, and all three email audiences |
| Quantity inside an adjective was mistaken for an already displayed count | Explicit separate quantity label when descriptor/count overlap | `three-tier carts (quantity: three)` keeps both meanings |
| Known street was replaced by its identifying city in display/maps query | Build unconfirmed display address from the current supplied street and city | Route card and generated Maps query retain street; no coordinates or confirmation invented |
| Tombstone placement changed same-turn conflict validation | Track incompatible assertions independently of tombstones | All permutations have the same validation result |
| Recaps clipped long labels or dropped questions after six | Capture-mode deduplication has no legacy item-length/list cap; HTML encoding does not truncate combined validated facts | Questions beyond six, long labels and a 100-item HTML/text boundary across visitor/Admin/Sales |
| Scorer gave credit for swapped responsibility/polarity and lost tentative counts | Ordered conservative comparisons, uncertain-quantity atoms, and entity-local projection checks | 13 independent scorer/parity mutation tests; valid alternatives that cannot be proven equivalent are marked for review |

The new scope is not a model-invented identifier. It must be copied from visitor evidence, such as a stop address or an item-group description. Contact remains a singleton so scope cannot create competing delivery identities. For routes, scope is internal stable identity; the visible route shows **current** city/address/purpose, not an obsolete address used to identify the original stop. Correct selection of scope and semantic aliases remains an extractor responsibility, not something literal validation can prove.

The public Anam SDK does not expose chunk indexes. Arbitrary in-flight replays therefore remain ambiguous. The accumulator preserves its established delta behavior for a boundary-completed user message; an unrecognizable non-prefix payload after an explicit final is ignored. These are tested ordering safeguards, not proof of perfect ASR or an explanation established from a new live recording.

### Final local verification for this follow-up

- `npm run test:evan:release`: **403/403** existing/regression checks and **107/107** capture/scorer checks.
- Full repository `npm test`, TypeScript, optimized Next.js build: **passed**. Full tests/build required normal local filesystem access after Windows sandbox path failures; no deployment or external extractor invocation.
- Changed capture/runtime/test lint: passed. The shared player's previously documented baseline lint finding remains; unrelated lifecycle code was not refactored to hide it.
- `offline-development-20261021-003.json`: 36 development conversations, seven prefix checkpoints, two repetitions (**86 empty-provider negative-control executions**), zero execution errors; 13 internal scorer self-checks and four supplied-record projection self-checks pass. The report is deliberately **not** a model-quality pass. Its 80 failed positive runs show that missing facts are penalized when the mock returns no facts.
- The 16 holdout conversations remain unexecuted and unseen by the implementation author. Reports 001 and 002 are preserved. New report version 2 records expanded source hashes, schema/instruction identity, partial parity coverage and remaining unmeasured dimensions.

Independent review details: `docs/operations/EVAN_CAPTURE_LOCAL_REVIEW_2026-10-21.md`.

### What to learn as the builder

This was not a request-wording problem. The important distinction is between **hearing**, **interpreting**, **retaining the current facts**, and **showing/sending them**. A passing parser test or one successful conversation did not verify all four stages. Some earlier tests supplied already-interpreted facts, which verified plumbing but could not prove interpretation accuracy. The revised tests now deliberately attack each boundary and the scoreboard itself.

For other X Agents, specify the shared fact contract, what a correction/removal means, who owns contact and delivery authority, and which consumer must show each field. Keep examples varied, reserve a holdout, and require same-version repeated calls only after the lower-level gates pass. Do not copy Evan's changes into other agents without their own evidence.

**Readiness remains blocked at the real-extraction evaluation gate under the local-only decision.** The redesign stays disabled, Evaluate stays on hold, and production/Anam/Qwen/audio are untouched. A future real extraction evaluation needs separately authorized provider testing or an explicitly selected local-model setup. No success percentage for real calls is claimed.
