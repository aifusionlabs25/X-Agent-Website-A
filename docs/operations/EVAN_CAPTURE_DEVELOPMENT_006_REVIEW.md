# Evan capture checkpoint: local development 006

October 21, 2026. **HOLD: not ready for another live test.**

## Scope and changes

This batch modifies only the local candidate capture builder, shared capture contract/projections, local tests, and documentation. It follows the existing Anam architecture and source-bound James-inspired capture approach. No new framework or model was introduced. The cloud extractor remains disabled; no provider requests, deployment, live call, email send, production configuration, persona, audio routing, or delivery-authority change occurred. Evaluate was explicitly told to remain paused. Existing preview URLs do not contain these edits.

The current real-builder workflow tests cover:

- Scoped additions: two existing chairs plus “one more” in the den remain two literal groups. No guessed aggregate is inserted, and removing the den group does not remove the original chairs. An unscoped added amount remains for review rather than overwriting the original count.
- Same-utterance date flexibility and adjacent apartment/unit identifiers survive into planner data and all three email drafts. New dates and full property corrections replace the previous values.
- Physical/handling observations bind to a uniquely identified existing item. Examples include a cracked lid, fixed legs, drawer count, material and width. They appear as item-scoped care notes, not extra inventory or ordered services. Same-part/material corrections replace the previous note; removing the item hides its notes and reinstatement restores the current note.
- Pronouns for these notes use the immediately preceding clause in the same visitor utterance. Ambiguous, hypothetical, quoted, third-party, and agent-only descriptions do not become confirmed item care.
- Unknown counts are linked to the separately identified item groups. A later count or removal clears only that group's count uncertainty.
- The v2 fact-category enum now includes `recapPreference`, with the same strict fact/evidence shape. It is an independent singleton: declining a recap does not delete email or override a request for coordinator contact. Contact display includes both statements; intake and email drafts retain the preference. This does not grant or modify send authorization. The optional cloud extraction instructions document the category but no cloud adapter was run.

Physical observations currently appear under care notes with an item scope, not inline inventory attributes. This is deliberate reuse of the existing record and UI projections; it must not be described as a new dedicated inventory-attribute schema.

## Verification of this candidate

| Check | Result |
| --- | --- |
| New qualified-details workflow suite | 18 passed; real builder, projections and local email drafts with a fetch tripwire |
| Evan release + capture suites | 403 + 219 = **622 passed**, zero failures |
| Repository `npm test` | 103 + 445 + 51 = **599 passed**, one opt-in real-provider test skipped |
| TypeScript | Passed |
| Changed-file ESLint | Passed |
| CRLF-aware diff whitespace check | Passed |
| Local optimized application build | Passed compilation, TypeScript, generation of 46 pages |

Suite totals overlap and are not independent accuracy samples. Initial repository/build attempts failed on Windows sandbox filesystem restrictions; reruns with normal local filesystem access passed. No product workaround or external service call was used to hide those environment errors.

## Frozen evaluation, unchanged oracle and scorer

Artifacts `local-development-20261021-005.json` and `local-development-20261021-006.json` are preserved under `work/evan-6097-promotion/capture-evaluation/`. Report 006 records the final source snapshot after a TypeScript annotation and capture-contract documentation adjustment. The two reports have identical outcomes. No corpus or scoring rules were changed in this batch.

Report 006 runs 36 development cases plus seven prefix checkpoints, twice: **86 executions, zero execution errors, 28 pass, 26 fail, 32 need review**. Repetitions and prefixes are not independent conversations. No source changed during the evaluation, `providerRequests` is empty, engine is local, and model is null. The untouched holdout was neither inspected nor executed.

| Automated measure | Proven / total | Needs review |
| --- | --- | --- |
| Expected-fact recall | 344 / 400 (86.0%) | 26 |
| Emitted-fact semantic support | 188 / 280 (67.1%) | 74 |
| Literal quote grounding | 280 / 280 | 0 |
| Quantity fidelity | 86 / 102 | 0 |
| Correction checks | 12 / 30 | 14 |
| Negative controls | 100 / 114 | 10 |
| Declared projection checks | 1,246 / 1,248 | 0; coverage is partial, 160 pairs omitted |

The precision lower bound is **lower** than report 004, while recall is higher. Additional retained observations increase records the old scorer does not match or adjudicate. That is not permission to discard those records from the denominator or advertise an adjusted accuracy score. Perfect source-quote containment still does not prove correct meaning.

## What still fails or remains unresolved

1. **Quantity contract:** the oracle expects computed totals and inferred singular counts, while the record requires literal source quantities. The additional armchair is now captured as its own scoped group, but it is not represented as an inferred total of three. “The sofa” is preserved without inventing a literal `1`. This remains an explicit representation gap, not a passing quantity score.
2. **Attribute/count-uncertainty placement:** the cracked lid, dresser details, fixed legs and uncounted groups are now present in scoped care/uncertainty output and covered by workflow tests. The oracle looks for those details in inventory attributes/count state. The scorer does not recognize that association; dedicated attribute representation versus accepted scoped-note behavior still needs a documented decision and independent review.
3. **Readback confirmation:** a phone readback confirmation is still not represented by the new record. The corresponding prefix test fails; subsequent replacement phone capture passes. Flags remain conservatively false, and no captured text confers delivery authority.
4. **Recap projection/matcher:** the separate recap fact is retained, and both preferences reach the contact display and drafts. The old parity check compares the entire combined contact-preference string to the coordinator preference alone, causing one failure per repetition. It also has no declared mapping for `recapPreference`. This is a reviewable contract/mapping discrepancy, not evidence the preference vanished or an email was sent.
5. **Known negative-matcher discrepancies:** “must be reserved” is flagged as an accomplished loading-bay reservation; a 90-inch sofa is flagged as a count of 90 despite its empty quantity. Actual values retain the requirement/dimension. These need transparent scorer adjudication with independent negative controls, not silent score inflation.

These observations are a coordinating-agent review, not an independent blind sign-off. The tests cover bounded language forms. Same-utterance flexibility is supported here; arbitrary later flexibility-only updates and every physical attribute/correction paraphrase are not claimed.

## Next readiness gate

Resolve and document the quantity, attribute/uncertainty, recap and confirmation representation contracts; independently adjudicate remaining discrepancies and strengthen controls for any scorer changes. Freeze that candidate and its scorer before running the reserved unseen transcripts. Only after the capture gates pass should a protected preview and scoped live test be prepared. No holdout success, general-call accuracy, rendering verification, delivery verification, or improved Qwen turn-taking is claimed at this checkpoint.

**Production is untouched. Evaluate remains paused. No new test URL is ready.**
