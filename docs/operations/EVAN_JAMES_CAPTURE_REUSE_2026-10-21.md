# Evan: James-informed deterministic capture checkpoint

Date: 2026-10-21 (America/Phoenix).

**Latest local checkpoint: frozen development evaluation 006. Live testing remains on HOLD. This is not a release approval.** See `EVAN_CAPTURE_DEVELOPMENT_006_REVIEW.md` for the latest changes, checks and unresolved record/scoring issues. Historical evaluations and their original scores below are preserved. No rehearsal preview has been deployed for these changes, and production is untouched.

## Decision and rationale

The user approved replacing the proposed paid-model capture path with a local deterministic approach informed by James. The useful James pattern is bounded, evidence-backed contact intake: recognize independent visitor name/phone/email clauses, bind short answers to the visitor's own contact question, reject control words and unknown/declined identities, preserve sibling facts, and carry current facts into consistent downstream views. James's past success is a design reference, not proof that Evan handles moving language reliably.

The relevant James references are `lib/james-canary/visitor-name.ts`, `candidate-intake.ts`, and `structured-brief.ts`. Evan adapts the contact parsing pattern in its own `lib/anam/evan-contact-identity.ts`; it does not import James's runtime, persona, services or state. The moving-domain builder is `lib/anam/evan-deterministic-capture.ts`, exporting `buildDeterministicEvanCapture(turns, revision)`.

The output remains the existing validated `evan_capture_v2` record. Current names, item descriptions, literal quantities, status, location and scope retain user-turn evidence. Planner, intake and email-content builders continue to project that shared record. This preserves the prior separation between understanding a statement and authority to send, choose recipients, confirm a phone/email, book anything, or close a call.

## Runtime and authorization boundaries

- Capture remains opt-in through `EVAN_CAPTURE_ENABLED=true` and is hard-blocked when `VERCEL_ENV=production`.
- The default `EVAN_CAPTURE_ENGINE` is `local`. Enabling capture alone does not select a model; existing model credentials do not silently switch the engine.
- Local capture executes the deterministic builder directly. It requires no capture-model name or API key and adds no paid-model request.
- The earlier cloud adapter remains in source for a separately authorized future choice. It requires explicit `EVAN_CAPTURE_ENGINE=cloud` plus configuration; it was not exercised in this work.
- No external model evaluation, Anam call, audio change, persona/model/voice update, environment-variable change, deployment, live session, or email send was performed by this verification work. No delivery recipients or delivery authority were changed.
- Holdout conversations and expectations remain untouched and unexecuted. This work used independent synthetic inputs, the recorded Run 47 wording and the development-only transcripts, predictions and expectations. Implementation repairs used development failures; those conversations are no longer an unbiased accuracy sample.

The transcript bounds remain 400 turns, 2,000 characters per turn and 80,000 characters per request. Output remains subject to the v2 schema and existing record limits. Bounds are rejection boundaries, not a promise to understand all statements within them.

## What was actually tested

`tests/evan-deterministic-workflow.test.mjs` calls the real deterministic builder and real production validation/projection/email-content functions. It does not inject expected facts, impersonate a model, or read the corpus. Every test installs a global fetch tripwire. Emails are prepared as local content only; no send function is invoked.

The initial 13 workflow tests passed after contact wiring and a generic Oxford-comma parser repair. They cover bundled Unicode contact, volunteered name correction, unknown/declined identity, agent/third-party contact negatives, arbitrary declared item descriptions and counts, quantity replacement/removal, same items at distinct role/address scopes, service question versus request, tentative packing, dimensions versus item counts, and deterministic full replay. Assertions include source validation and applicable planner/intake/three-audience recap parity.

Independent adversarial expansion then found material false positives despite that initial green suite. The first expanded run was **13 passed / 8 failed across 21 tests**. Failures included contracted ownership negation, negative quantities such as “no sofas,” third-party possessions, quoted possessions, hypothetical ownership without question punctuation, an “I have a question” preface, and ownership immediately followed by an explicit exclusion. A lexical metamorphic test also found a generic `include`/`includes` token-boundary bug that produced invalid source output.

The suite then grew to 22 tests. The additional mixed-clause control requires a valid independent visitor-owned item to survive alongside a rejected negative, third-party, quoted or hypothetical clause in the same turn. This prevents fixing false positives by discarding whole turns. The metamorphic controls use three unfamiliar item descriptions across four accepted ownership/list forms; they do not add nouns to production vocabulary. Following generic source/grammar repairs, an independent rerun passed **22/22 unchanged workflow tests**.

Two additional independent tests replayed the recorded Run 47 phrasing and unfamiliar-item continuation sentences. Their first run was **22 passed / 2 failed**: the real “how many boxes” question produced no inventory, and “There’s also” could become a spurious item instead of just a sentence prefix. Generic question/continuation repairs closed both. The current unchanged workflow suite passes **24/24**, independently rerun after the report 004 freeze; its ESLint check also passes. The Run 47 test verifies both the mid-call inventory prefix and final record through planner, intake and all three locally prepared email bodies. It preserves the box range, queen bed, love seat, desk, bundled contact, callback tomorrow and dish-packing question without treating that question as ordered packing. This is not a browser rendering or email-delivery test.

Root's initial full repository test run passed with normal local filesystem access, and the initial optimized build compiled successfully. Those checks predate the latest adversarial repairs. The final verification checkpoint below distinguishes fresh verification from these historical results.

## Preserved first real deterministic development baseline

Artifact: `work/evan-6097-promotion/capture-evaluation/local-development-20261021-001.json`.

This report is **actual local deterministic output**, not the earlier empty-provider mock baseline. It records 36 development conversations, seven development prefix checkpoints and two repetitions: 86 executions. `mode` is `local-deterministic`, `model` is `null`, and `sourcesChangedDuringRun` is empty. There were two execution errors, 64 failed runs and 14 review-needed runs. It describes that earlier code snapshot, not the subsequent repairs.

| Measure | Proven / total | Conservative result |
| --- | --- | --- |
| Expected fact-atom recall | 186 / 400 | 46.5% |
| Emitted-fact precision / semantic support | 106 / 222 | 47.7% |
| Quantity fidelity | 32 / 102 | 31.4% |
| Correction handling | 4 / 30 | 13.3% |
| Negative controls | 82 / 114 | 71.9% |
| Literal quote grounding | 222 / 222 | 100% |
| Declared entity-local projection checks | 1,000 / 1,000 | 100%, explicitly partial |

Recall uses expected atoms; precision uses emitted fact records. These denominators are not interchangeable. Repetitions and checkpoints are included, so this is not an independent sample of 86 customers or a production reliability estimate. The report includes 38 recall atoms and 68 emitted facts awaiting semantic adjudication. Ambiguous entries are unproven in the lower bound, not silently counted as successes.

The perfect literal-quote and checked-projection results do **not** offset the capture failures. Literal words can be assigned to the wrong owner/status, and planner/email projections can consistently repeat the same incorrect record. The parity report explicitly omits 116 pairs and marks coverage incomplete; browser/HTML behavior, delivery/privacy rules, extra/removed output and event races require their own checks.

## Preserved development progression and current frozen result

All four reports are append-only artifacts under `work/evan-6097-promotion/capture-evaluation/`, named `local-development-20261021-001.json` through `-004.json`. They use the same development split and unchanged scoring rules. No source changed during any of these four evaluation runs.

| Report | Expected fact recall | Quantity fidelity | Execution errors | Failed / review / automatic pass executions |
| --- | --- | --- | --- | --- |
| 001 | 186 / 400 (46.5%) | 32 / 102 (31.4%) | 2 | 64 / 14 / 6, plus 2 errors |
| 002 | 280 / 400 (70.0%) | 68 / 102 (66.7%) | 0 | 46 / 24 / 16 |
| 003 | 312 / 400 (78.0%) | 82 / 102 (80.4%) | 0 | 42 / 26 / 18 |
| 004 | 338 / 400 (84.5%) | 86 / 102 (84.3%) | 0 | 32 / 28 / 26 |

Report 004 is the current frozen development result. It contains 36 conversations plus seven prefix checkpoints repeated twice: 86 executions, **not** 86 independent callers. Its builder hash is `86378df3a32de5e9660b18ff9a36def8e8a390ba274ada58843bf8cd20a5804c`; `sourcesChangedDuringRun` is empty, model is null and provider requests are zero.

The automated lower bounds are:

- Expected fact-atom recall: **338/400 (84.5%)**, with 22 atoms needing review.
- Emitted-fact semantic support: **194/260 (74.6%)**, with 48 records needing review.
- Quantity fidelity: **86/102 (84.3%)**.
- Correction checks: **12/30 (40.0%)**, with 14 needing review.
- Negative controls: **100/114 (87.7%)**, with 10 needing review.
- Literal quote grounding: **260/260**. This is source containment, not proof of correct meaning.
- Declared entity-local projection checks: **1,152/1,152**, with **156 omitted pairs** and coverage explicitly incomplete.

The conservative figures were not replaced with optimistic upper bounds or manually adjusted pass totals. A detailed qualitative audit of report 003 is preserved in `EVAN_CAPTURE_DEVELOPMENT_003_REVIEW.md`; it separates genuine bugs from contract and scorer limitations. Its failed outcomes remain historical evidence even where report 004 fixes them.

### What the current batch fixes

Confirmed by independent inspection of report 004, in addition to the regression tests:

- The bookcase removal is now reflected at the intermediate checkpoint, before later reinstatement. Final-only success no longer hides that deletion error.
- Compound sofa removal and nightstand-count correction update the intended items; the command phrase no longer becomes inventory.
- Confirming the possible Mesa storage stop removes its stale uncertainty.
- A mixed city-pair/inventory answer preserves the route while a later removal targets only the sofa.
- Distinct street-address stops in the same city remain distinct; removing the donation stop retains the storage address.
- A question about an owned sofa followed immediately by explicit inclusion on the move list can preserve the sofa and its 90-inch descriptor without treating a generic service question as confirmed belongings.
- Callback extraction no longer mistakes an unrelated “I’m in Mesa today” clause for callback timing; an indirect request to call tomorrow about an estimate is retained.

### What still fails or remains incomplete

These are real outstanding capture gaps in report 004, not a claim that the remaining failures are merely test noise:

1. **Additional quantity groups:** “one more armchair in the den to add” is still dropped. The initial two remain, but the separate extra chair does not.
2. **Attached details:** date flexibility, a cracked lid and related handling request, dresser material/drawer count/width, unit number, and the sofa’s non-removable legs are omitted or left only in a generic review note instead of attached to the relevant fact.
3. **Specific state:** “I haven’t counted those yet” remains a generic unknown note, not item-linked count uncertainty. Recap-email refusal is not separately represented alongside permission for coordinator email contact. The latter is a capture gap; these local checks did not send any email or establish a delivery-authorization failure.
4. **Declared contract gaps:** the schema keeps literal quantity evidence rather than inferring one from “the loveseat” or calculating three from two plus one. The contact projection also leaves confirmation flags false, so a phone-readback prefix expectation still fails even though the replacement phone is correctly unconfirmed at the final snapshot. Those capabilities need explicit representation decisions, not fabricated literal evidence.

Independent review also identified automated false positives that must remain distinct from these omissions:

- The loading-bay value says “must be reserved,” not that it has been reserved. The automated exclusion matches those words too broadly.
- “90-inch sofa” has a blank quantity; the automated “90 sofas” exclusion incorrectly treats the descriptor as an item count.
- Several self-packing, negative-access, date-correction, scoped-packing and stop-removal outputs preserve the intended meaning but remain `needsReview` under the conservative matcher.

No scorer, expected value or denominator was changed to remove those concerns. These observations explain the result; they do not create a release pass.

## Final verification checkpoint

The coordinating agent completed the following checks against the report 004 candidate after the source freeze:

| Check | Result |
| --- | --- |
| Evan release and capture suites | **604 passed**: 403 existing release tests plus 201 capture tests |
| Independent workflow suite (included above) | **24/24 passed**, independently rerun after the freeze |
| Direct deterministic grammar suite (included above) | **30/30 passed** |
| Route-clause suite (included above) | **6/6 passed** |
| Full repository `npm test` | **599 passed** across its three groups (103 + 445 + 51), **1 skipped** |
| TypeScript | Passed |
| Changed-file ESLint | Passed |
| CRLF-aware diff whitespace check | Passed |
| Optimized application build | Compiled; TypeScript and generation of 46 pages passed |

These suite totals overlap; they must not be added together as independent tests. The single skipped repository test is the opt-in real Hermes provider check. No real provider verification was authorized or performed.

The initial sandboxed repository run failed on Windows temporary-directory permissions, and the sandboxed build failed on compiler path canonicalization. Repeating those local checks with normal filesystem access passed without a product-code workaround. These environment failures were not hidden, and their successful reruns did not send model requests or change production.

The green regression/build checks show that the candidate executes and preserves covered behavior. They do **not** cancel the genuine capture omissions in development report 004 or establish readiness for arbitrary conversations.

## Limits of this approach

This is bounded grammar, not unrestricted language understanding. It can accept unfamiliar item nouns in a recognized ownership/list frame without knowing every furniture word. That does not establish support for arbitrary paraphrases, nested corrections, aliases, pronouns, mixed ownership, ranges/bounds, every packing responsibility statement, or every route/access expression.

Unknown or ambiguous statements should remain reviewable rather than becoming asserted moving scope. Existing local tests demonstrate selected forms only; unsupported or omitted meaning cannot be reported as correct merely because the schema validates. Contact normalization is conservative: the current phone policy is North American numbering, and ambiguous spelled/ASR email forms are not permission to infer an address. A captured contact field still does not confer confirmation or delivery authority.

The deterministic scorer is also limited. It intentionally sends reordered or otherwise ambiguous paraphrases to review and reports partial projection coverage. Human adjudication may resolve some apparent misses, but it cannot justify invented facts, incorrect counts, lost corrections, or denominator removal.

## Required next checkpoint

1. Address additional-group and qualifier/state association as explicit record behavior, with positive and negative sibling controls. Do not expand vocabulary one fixture noun at a time or weaken source validation.
2. Settle literal versus inferred quantity and confirmed-contact representation before claiming those capabilities. Any proposed scorer or contract correction must be separately documented; preserve existing reports.
3. Re-freeze code, validation, projections and scoring; run the local regression suites and development evaluation, then independently inspect remaining semantic discrepancies.
4. Keep the untouched holdout separate until the development candidate and scoring rules are settled. No holdout result is currently claimed.
5. Maintain the live-testing hold. Only a subsequent explicit readiness decision should produce a protected preview and a scoped live-test handoff. This checkpoint does not unpause Evaluate or deploy anything.

The local no-paid-model execution path is implemented and targeted regressions now pass. **Evan is not yet ready for another live test on the capture redesign.**
