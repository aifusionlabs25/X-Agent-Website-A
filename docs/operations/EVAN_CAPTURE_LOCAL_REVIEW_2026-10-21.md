# Evan capture: independent local verification review

Date: 2026-10-21. Scope: local scorer, test design, and release-gate evidence. This is a review checkpoint, not a frozen-candidate result or release approval.

## Recommendation

Keep capture disabled and the live-testing hold in place. The local suites meaningfully test deterministic boundaries, but they do not measure whether a real extractor produces correct facts, how long it takes, or whether the full browser/voice path behaves correctly. No external model, real transcript evaluation, deployment, Anam call, or email send was performed in this review. No holdout conversation or expectation was inspected or executed. Historical report `offline-development-20261021-002.json` was not changed.

## What the existing tests establish

| Evidence | Meaningful supported claim | Remaining boundary |
| --- | --- | --- |
| Core validation/projection tests | Strict schemas, literal user provenance, correction ordering for supplied facts, contact tombstones, route capacity and enrichment identity | A quote does not prove ownership, polarity, certainty or current meaning |
| Client/deferred-promise tests | Debounce/coalescing, stale revision rejection, cancellation, bounded waits and explicit degraded state | Most race tests use empty records; mounted-consumer and actual player-event behavior need separate coverage |
| API tests | Origin/session/persona ownership gates, bounds, rate limits and sanitized failures | Mocked authorization dependencies do not constitute a protected-browser rehearsal |
| Final dispatch tests | Final transcript/receipt identity, one capture reused for three messages, failure notices, recipient authority separated from captured email | In-memory transport is neither actual delivery nor extractor-quality evidence |
| Component-render adapters | Selected text/state/exit-control rendering with supplied inputs | Effects are suppressed in some adapters; this is not full React lifecycle, browser layout, audio or ASR evidence |
| Empty-provider corpus run | Harness execution and missing-fact negative control | Repeating empty responses cannot establish semantic reliability or latency |

The dispatch tests' global network tripwire is particularly useful: unforwarded fetch calls fail rather than accidentally reaching a service.

## Confirmed scorer defects repaired in this review

1. **Relational false credit.** Unordered token matching awarded full recall, precision and semantic-grounding credit to `You pack books and we pack dishes` when the expectation was `We pack books and you pack dishes`. It also certified `Stairs available and no elevator` against `No stairs and elevator available`. Each adversarial fact had a literal user quote, but that user turn rejected the earlier wording and supplied the correction. These are scorer mutation probes, not proposed runtime predictions.
2. **Uncertain quantities disappeared from the denominator.** A tentative `three cabinets` against an expected tentative `two cabinets` earned full recall and precision, with quantity denominator zero. The uncertain entity is now bound one-to-one and its expected quantity is a separate scored atom. Valid, incorrect and absent outputs retain the same denominator.
3. **Consumer parity did not bind quantity to its item.** The earlier harness searched whole joined text for an item and separately for its count, allowing counts swapped across two entities to appear correct. It now checks full entity-local labels, including quantity, endpoint role, literal scope and uncertainty labels, in planner/intake and all three text email audiences. Route checks bind city, address and purpose to one matching planner stop. Questions, care, access, property and preferences now have declared checks where the consumer exposes them.

The scorer now retains meaningful conjunctions, prepositions, modality and contractions, distinguishes reflexive visitor/provider roles, and requires ordered normalized token coverage for automatic matching. Reordered valid paraphrases can therefore become `needsReview`. Exact unambiguous values and covered, order-preserving aliases still score automatically. This is a conservative comparison rule, not general semantic entailment or a production extraction patch.

`tests/evan-capture-scorer-review.test.mjs` contains 13 independent tests, including multiple mutation pairs. All 13 passed. Projection mutations swap counts and scopes, change endpoint labels, strip uncertainty, drop questions, use numeric substrings and mix addresses between same-city stops. Positive controls retain quantity-bearing adjectives and scoped labels. The factories support the newly required v2 `scope` field; fingerprints include scope, and unjudged scope/route content cannot silently receive semantic precision credit. A one-case offline development smoke completed with zero execution errors and the existing 13 scorer / four projection self-checks; its intentionally empty provider output failed the positive case as expected. No new evaluation artifact was saved because the candidate was still changing.

## Remaining high-value gaps

### Projection parity remains explicitly partial

The repaired harness reports per-run and summary coverage with `complete: false`, checked pairs, omitted pairs and reasons. Contact privacy/delivery policy is intentionally outside literal summary parity; the planner has no dedicated question field; an asserted route without an endpoint role is not projected as a confirmed stop. HTML/rendered browser output, removed-fact resurrection, unintended extra output, route order beyond the corpus oracle, and session/revision races remain unmeasured by this particular metric.

Before claiming complete parity, add dedicated checks for each remaining dimension, especially simultaneous correct and contradictory copies and resurrection of excluded old values. Include denominator coverage, not only percentage over selected checks. Existing dedicated email tests add useful evidence but do not make this metric exhaustive. Full-label comparisons still use review for unfamiliar paraphrases and cannot prove all relational meaning inside a free-text value.

### Literal provenance remains weaker than semantic grounding

Production validation accepts an incorrect status/role/category when the value and quote are literal user substrings and structurally valid. That is an acknowledged design limitation, but it means the evaluation plan's aspirational wrong-status/subject/category rejection gate is not fulfilled by span validation. Do not report these local probes as proof that semantic corruption is prevented. Real extractor evaluation and human adjudication remain separate, currently unauthorized work.

### End-to-end event and scope tests must precede another readiness claim

Use nonempty records and an actual player-event adapter to check: late partials after final, expanded finals under the original message identity, newer correction authority, private contact removal while work is pending, session restart, and final-provider/live-stream divergence. Assert both intermediate and final outputs, not only final revision numbers. The newly added event-path and invariant suites were being worked on concurrently during this review; a transient combined run was 82/90 passing with eight failures in those other review suites. That is not a final candidate result. Re-run after repairs and freeze, preserving any prior failures as evidence.

## Release gate

1. Close deterministic failures and run the complete local capture/release suites, types and build against one stable snapshot.
2. Preserve the exact candidate, including untracked files not covered by the current tracked-diff hash. Keep the original evidence artifacts append-only.
3. Under the current local-only approval, stop at an honest boundary-tested implementation checkpoint. Do not infer authority for a provider evaluation, holdout run, protected preview enablement, or live session.
4. If future extraction evaluation is explicitly authorized, freeze the scorer, schema, model/configuration, implementation and corpus first; adjudicate ambiguous outputs and hard safety gates separately from aggregate percentages. Only then consider an untouched holdout and a separately authorized same-version live rehearsal.

No measured extractor success rate, clean-holdout generalization, real latency, or live readiness is established by this review.
