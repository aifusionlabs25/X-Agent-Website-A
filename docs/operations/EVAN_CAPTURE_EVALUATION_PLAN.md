# Evan grounded capture evaluation plan

## Purpose and scope

Evaluate whether Evan captures what the visitor actually said into one consistent, current move record. The known name and inventory regressions motivate this work, but fixing their exact wording is not sufficient evidence of reliability. The evaluation must detect omissions, invented facts, wrong ownership, wrong certainty, stale corrections, quantity corruption, and disagreement between the planner and recap/email views.

The companion corpus is `tests/fixtures/evan-capture-varied-transcripts.json`, version `evan-capture-varied-v1`: **52 synthetic conversations, 36 development and 16 holdout**, with nine explicit prefix checkpoints and two semantic-equivalence groups. The runner is `scripts/anam/evaluate-evan-capture.mjs`. Merely loading fixture data, passing its structural check, or running the offline empty-provider baseline does not show that capture works.

All identities, addresses, emails, and phone numbers are synthetic. **The current user-approved verification scope is local only. No external model evaluation is authorized or performed in this task.** `--local` evaluates the actual deterministic capture implementation adapted from James's source-bound workflow. It needs no API key or model. The default without that flag remains the empty-provider negative control. Neither mode makes external model calls, Anam calls, email sends, geocoding, production writes, or live sessions. The runner retains an opt-in `--live` capability for a separately authorized future synthetic-provider evaluation; that command is deferred, not permission to run it now. `--live` is a synthetic extraction evaluation, not a live voice session. No existing scorecard, candidate report, or live-test result should be edited or replaced by results from this corpus.

## Split discipline

1. Implementers may read development cases, their expectations, and this plan while developing the capture system.
2. Keep holdout turn text and per-case expectations out of implementation prompts and debugging output until a candidate is frozen. The independent fixture author should report only category coverage, counts, and schema before that point.
3. Freeze the candidate's commit plus uncommitted diff identity, extraction configuration, normalizers, matcher rules, and test harness. Hash the corpus. A dirty worktree needs a diff hash or preserved patch as well as a commit hash.
4. Run holdout once against that candidate, without retrying cases selectively. Record all results, unsupported categories, invalid outputs, and timeouts.
5. If holdout findings inform a revision, those cases become regression/development evidence. Keep the original results, and author a new independent holdout for another clean generalization claim. Never rename a failed holdout case as development and omit the failure from the report.

The split is procedural, not a security boundary: both partitions live in one repository file and an implementer could read them. Record any accidental exposure. The corpus author is not blind to the holdout; the implementation author must be. Synthetic coverage supports an offline quality claim only, not a statistically representative production reliability percentage.

## Coverage

The corpus combines natural positives with matched or nearby negative controls. It deliberately varies furniture nouns, clause order, split versus bundled answers, fragments, punctuation, casing, apostrophes, diacritics, and semantically equivalent phrases. Correctness must not depend on expanding an enumerated furniture vocabulary one failed noun at a time.

| Dimension | Required distinction |
| --- | --- |
| Contact | Explicit self-introduction or question answer versus occupation, location, example identity, or third-party contact |
| Inventory | Open-ended actual move items versus items in questions, imagined purchases, quoted examples, or agent suggestions |
| Quantity | Exact count, approximate value, range, lower/upper bound, and unknown count; dimensions, room counts, contents, and unit numbers are not object counts |
| Certainty | Confirmed fact, actual undecided possibility, explicitly declined item, and counterfactual example |
| Corrections | Replacement versus addition, targeted removal, aliases for the same object, full item-list reset, and reinstatement |
| Route | Direction, endpoint role, definite versus possible stop, two different stops in one city, and selective cancellation |
| Timing | Move date/window versus callback window, with no invented year, exact day, or booking |
| Access | Origin versus destination, unavailable elevator versus elevator present, and required reservation versus completed reservation |
| Packing | Self-packing, declined assistance, limited requested scope, unresolved responsibility, and full packing |
| Communication | Display removal, contact-channel preference, recap refusal, confirmation, and delivery authority are distinct fields |
| Grounding | User-supplied evidence, question context, agent-only assertion, rejected readback, and ambiguous acknowledgment |
| Shared record | Same current facts, quantities, certainty, provenance, and deletions across every applicable consumer |

The holdout contains 16 categories: contact bundles, broad inventory vocabulary, transcription variation, third-party quotation, hypotheticals, agent-only contamination, inventory correction, inventory reset, certainty transition, access correction, route correction, contact removal, timing scope, packing scope, identity correction, and a multi-domain conversation. Do not publish holdout examples before the freeze.

## Fixture schema

The top level has `schemaVersion`, `corpusId`, source/policy descriptions, `quantityKinds`, and `cases`. Each case has:

- `id`: stable, unique identifier; do not change it to hide a regression.
- `split`: `development` or `holdout`.
- `category`, `tags`, and optional `metamorphicGroup`: coverage and pairing metadata, not extraction inputs.
- `turns`: ordered `{ role: "user" | "agent", content: string }` entries.
- `expectations`: required semantic facts and explicit exclusions for the final record.
- Optional `checkpoints`: `{ afterTurn, expectations }` assertions on the inclusive prefix through that zero-based turn.
- `notes`: adjudication constraints and intentional pitfalls. Do not feed notes or expectations to the capture implementation.

Expectation shapes:

| Key | Shape and interpretation |
| --- | --- |
| `contact` | Field-name object; each field has `{ value, sourceTurns, acceptedValues? }`. Values may be strings or booleans. Missing fields are not an instruction to clear them. |
| `inventory` | Array of `{ item, quantity, sourceTurns, qualifiers?, acceptedValues? }`. Each entry is an entity, not a substring requirement. An empty array explicitly requires no confirmed inventory. |
| `quantity` | `{ kind: "exact" | "approximate", value }`, `{ kind: "range", min, max }`, `{ kind: "at-least", min }`, `{ kind: "at-most", max }`, or `{ kind: "unspecified" }`. Unknown does not mean zero or one. |
| `route` | Ordered stops `{ kind, city, sourceTurns, address?, purpose? }`; `kind` is `Origin`, `Additional stop`, or `Destination`. Empty means no established route. |
| `details` | `{ field, value, sourceTurns }` facts for timing, property, access, packing, care, and communication. Field paths express semantic scope, not an imposed production object layout. |
| `uncertain` | `{ field, value, reason, sourceTurns, quantity? }`; useful unresolved facts that must remain distinguishable from confirmed scope. |
| `absent` | `{ field, value?, reason }`; forbidden current facts, or an entire empty field when value is omitted. No `sourceTurns` is required because the case transcript supplies the negative context. |
| `removed` | `{ field, value, sourceTurns, acceptedValues? }`; formerly mentioned facts that must not survive as current facts after the cited correction. |

`sourceTurns` are zero-based indexes. They identify evidence, not a string equality oracle. Every expected positive fact has at least one user turn. Some answers additionally cite the preceding agent question for context. A candidate may cite a different sufficient user-backed subset than the fixture; it may not cite future turns or only the agent. Removed facts may remain in raw transcript history or an explicitly historical audit trail, but not in a current inventory list, route, sales lead, or recap fact section.

Only listed fields are positive recall assertions, except empty arrays and exclusions which impose the stated negatives. This is not permission for arbitrary extra facts: audit **every emitted current fact** for grounded precision. A valid extra fact explicitly entailed by the transcript is not a false positive. Unsupported facts are false positives even if the fixture does not enumerate them. Missing expected facts cannot be excused as untested fields.

## Adapter contract: one record, multiple consumers

The runner adapts the shared capture entry point using only ordered turns and a deterministic snapshot/revision identifier. It does not send fixture `id`, category, tags, notes, or expectations to extraction. Separately supplied synthetic check-in context belongs only to projection tests. Do not add fixture-specific branches to production code or pass expected values into a fake extraction result.

Return or expose the canonical record plus projections for:

1. Contact shown in the planner.
2. Move Brief and Move List, including quantities, uncertain items, access, and packing.
3. Confirmed route and possible-stop views; mock geocoding and inspect requested inputs rather than making network requests.
4. Visitor recap and sales/coordinator email fact sections. Generate content offline without invoking send functions.
5. Applicable structured intake/lead payloads.

Prefer adapters into existing pure builders such as `buildEvanMovePlan`, `buildEvanPlannerContact`, `buildEvanMovingIntake`, and `buildEvanEmailBundle`, or their replacement shared-record entry point. Test the production path consumers actually call. A separately tested extractor that is not wired into the UI and email builders does not prove the feature is fixed.

The runner evaluates every listed checkpoint and the final prefix. It currently performs independent snapshot extraction, not turn-lifecycle event simulation. The separate event suite must also compare complete replay with incremental turn accumulation; these must agree after the same authoritative final snapshot. Record visible intermediate output: a correct final result must not mask a brief fabricated fact or stale contact detail.

Some projections intentionally omit fields or protect contact details. Declare this projection policy before scoring. A visitor recap need not expose private coordinator-only metadata, but it cannot contradict the same shared fact. A confirmed delivery identity supplied separately from spoken contact must stay authoritative for delivery; a spoken proposed email is a display/review field, not permission to silently reroute email. Run this check with separate synthetic check-in context rather than changing the fixture's asserted spoken facts.

## Normalization and matching

Match meaning and state, not renderer labels or order of unrelated inventory entries. Normalize Unicode to NFC, whitespace, typographic apostrophes, and harmless capitalization. Phone comparisons use canonical digits; tests are North American synthetic numbers and do not establish a universal phone-normalization policy. Case-insensitive name matching is allowed for casing-only transcription variants, but diacritics, name components, and spelling must survive. `acceptedValues` marks explicitly permitted alternatives.

Common true aliases can match one entity: sofa/couch, nightstand/bedside table, and carton/box. Do not merge every similar noun: a loveseat is not automatically the excluded sofa, and two same-city route stops are not one stop. Preserve meaningful qualifiers such as size, damage, and requested handling. A category label such as "furniture" does not recover four omitted items. If an alternative representation is valid, the matcher must retain its quantity, scope, certainty, and entity identity.

Atomize each record into comparable facts. A useful inventory atom set includes entity presence, quantity kind, quantity values/bounds, relevant qualifiers, and confirmation state. Use one-to-one entity matching before scoring atoms so duplicate aliases cannot inflate recall. Counts nested inside containers may be represented as nested inventory or a qualifier, but must not change the number of containers. An approximate count presented as exact earns presence credit but fails quantity/certainty fidelity and adds an unsupported precision claim.

The comparator should be deterministic for explicit structures and clear aliases. Route ambiguous semantic matches to an offline human reviewer using only the transcript, output, and rubric. Count and report adjudications. An external model judge is not required or authorized here. Never fix a failed matcher by quietly weakening an expectation; record a versioned adjudication and rerun the unchanged candidate if the fixture itself is demonstrably wrong.

## Metrics and release gates

Report numerator and denominator, by domain and category as well as overall. Report micro averages over atoms and macro averages over cases/categories. A long inventory list must not conceal failures in contact privacy or negative controls. Denominator zero is **N/A**, not a perfect score. Case pass counts are debugging aids, not the headline quality measure.

| Measure | Calculation or required evidence |
| --- | --- |
| Fact recall | Matched expected current fact atoms / expected current fact atoms. Report contact, inventory identity, quantity, route, timing, access, packing, and uncertainty separately. |
| Fact precision | Grounded emitted current atoms / all emitted current atoms, including extras not named in expectations. Duplicate representations of one logical fact do not earn additional credit. |
| Grounding validity | Emitted facts with source evidence that entails subject, role, value, scope, polarity, certainty, and current state / all emitted facts requiring evidence. Missing provenance is a failure if the shared record promises provenance. |
| Quantity fidelity | Correct quantity kind and all values/bounds / expected quantity-bearing entities. Also report invented quantities on unspecified-count items. |
| Uncertainty fidelity | Correctly retained unresolved atoms and correctly resolved atoms, with separate counts for false promotion and lost uncertainty. |
| Correction handling | Targeted replacements/removals/reinstatements correct at the first eligible checkpoint / expected transitions; separately count collateral deletions and stale resurrection. |
| Consumer parity | Required shared atoms preserved without contradiction across all applicable projections / applicable atom-projection pairs; also report any conflicting consumer pair. |
| Metamorphic consistency | Equivalent normalized records within each declared group; separately report recall so equally empty outputs cannot pass as quality. |
| Coverage of evaluation | Evaluated assertions / corpus assertions, with unsupported fields, skips, invalid outputs, and timeouts disclosed. Unsupported fields cannot become silent skips. |

An exact source quote is **necessary evidence in some designs, not sufficient validation**. A quote saying an item is not moving cannot justify an asserted inventory item; a quoted form example is not user contact; an agent's readback is not independent user evidence. Evaluate semantics and latest state as well as quote spans.

Recommended candidate gates, to be fixed before the holdout run:

- Zero invented contact identity, unauthorized email-delivery changes, agent-only route/contact facts, or resurrection of explicitly removed contact data.
- Zero prohibited negative/hypothetical/third-party facts promoted into current confirmed scope in the curated negative controls.
- All explicit corrections/removals and endpoint bindings correct at their checkpoints; no stale overwrite in event-order tests.
- No contradictions between shared-record projections; 100% parity on fields each projection claims to display.
- At least 95% micro fact recall and 99% micro fact precision on the supported offline scope, with every domain at least 90% recall; report exact denominators and uncertainty about generalization. For a small corpus, a single failure may materially change a percentage.
- No category silently unsupported. If a capability is deliberately deferred, mark the candidate incomplete for this capture objective and describe what users will not see; do not inflate a score by removing its denominator.

These are acceptance recommendations, not measured results or existing product guarantees. Safety gates cannot be offset by many easy positive cases. Failure on a broad language capability should prompt a model/schema/state-design correction, not a phrase-specific production regex or a growing whitelist of fixture nouns.

## Event-sequence tests beyond turn-only fixtures

The JSON conversations test content semantics. They cannot by themselves prove race safety, turn lifecycle, model grounding validation, final-transcript authority, or network-derived state. The capture harness needs a separate deterministic event suite:

| Sequence | Required invariant |
| --- | --- |
| Start extraction for revision 8; start revision 9; return 9; then return 8 | Revision 8 cannot overwrite the newer record, reintroduce removed facts, or reset confidence. Check every mounted consumer. |
| Same transcript ID extends from partial text to completed text | Content/finality changes trigger the correct revision despite stable ID; one final turn is not double-counted. |
| A late partial arrives after that turn's completed event | Final content wins; the record does not regress to an incomplete name, quantity, or route. |
| Two complete snapshots repeat an unchanged turn | Idempotent facts and quantities; no doubled inventory or duplicate stops. |
| A phone/email is removed while an earlier extraction is in flight | Removal persists until an explicit, later user reinstatement. Display fallback must not resurrect a hidden check-in field. |
| User corrects an address while the old geocode request is pending | Old coordinates/results are rejected for the new route entity and revision; directions use only current confirmed stops. |
| Final provider transcript adds or changes content relative to live accumulation | Apply the documented authoritative reconciliation policy, then derive all close/recap/email facts from that same final revision. Do not mix live contact with a different final inventory. |
| Extraction submits an exact quote with wrong status, subject, category, or role | Validation rejects or quarantines the unsupported semantic claim; quoting text cannot launder a negation or agent-only statement into a fact. |
| Readback confirmation predates a corrected phone/email | The corrected value remains unconfirmed until its own grounded confirmation. |
| Session closes, component remounts, or a new session starts | No previous-session facts, pending result, hidden-field state, or finalization snapshot leak into the new session. |

Use stubs, deferred promises, and synthetic messages for these tests; do not sleep on wall-clock timing. Inject outputs through the same validation/merge path used in production. If production extraction depends on an external model, stub the transport but not semantic validation, revision arbitration, or consumer projection. Report separately what an offline stub validates and what remains unmeasured about live model extraction.

## Local run procedure

First inspect development only, without displaying the holdout:

```powershell
node -e "const fs=require('node:fs'); const f=JSON.parse(fs.readFileSync('tests/fixtures/evan-capture-varied-transcripts.json','utf8')); console.log(JSON.stringify(f.cases.filter(c => c.split === 'development'), null, 2));"
```

A metadata check can report the partition counts without exposing holdout language:

```powershell
node -e "const fs=require('node:fs'); const f=JSON.parse(fs.readFileSync('tests/fixtures/evan-capture-varied-transcripts.json','utf8')); console.log(f.corpusId); console.log(f.cases.reduce((a,c)=>(a[c.split]=(a[c.split]||0)+1,a),{}));"
```

Run the offline scorer/provider-boundary check, without any provider call:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/anam/evaluate-evan-capture.mjs --split development --repeat 2
```

Offline mode exercises `extractEvanCapture` with a synthetic provider response containing zero facts. It also runs independent scorer self-tests for positive matching, missed facts, incorrect quantities, exclusions, unjudged extras, ranges, non-quantity numbers, and correction matching. Its intentionally poor recall is a **negative-control baseline**, not the product's measured recall. The runner exits successfully when this baseline executes; it must not be promoted or reported as model quality. No expected fixture answer is synthesized into provider output.

Run the **actual local implementation**, with no provider or credential, and preserve a new result file:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/anam/evaluate-evan-capture.mjs --local --split development --repeat 2 --output work/evan-6097-promotion/capture-evaluation/local-development-20261021-001.json
```

Local mode constructs an isolated local-engine configuration and rejects provider requests. It executes the same service, validation and consumer projections used by the candidate API and final email preparation. These are actual rule-based predictions, not supplied answers. The implementation and contact helper are included in source hashes. Passing unit tests is still not a substitute for this varied corpus. Freeze before running the holdout; do not run it while implementation files are being edited.

For a future, separately authorized evaluation only, an operator could supply rehearsal capture environment variables securely and run actual synthetic extraction. This is **not authorized by the current local-only verification decision**:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/anam/evaluate-evan-capture.mjs --split development --limit 4 --repeat 2 --live --output work/evan-capture-evaluation/development-run-001.json
```

`--split` accepts `development` (default), `holdout`, or `all`. Holdout/all must be explicit; neither is iterated automatically. `--limit N` selects the first N cases in the chosen partition and is for smoke checks, not a full-corpus claim. `--repeat N` repeats every selected checkpoint/final snapshot, defaults to 1, and is capped at 10. The runner prints the planned call count before starting. `--output` must name a new `.json` file inside the current worktree; existing files are not overwritten. Without it the detailed report is returned internally and a compact summary is printed, so use an output path for evidence preservation.

The runner does not load `.env` files. For the separately authorized cloud mode only, the caller must supply `EVAN_CAPTURE_ENABLED=true`, `EVAN_CAPTURE_ENGINE=cloud`, `EVAN_CAPTURE_MODEL`, and `OPENAI_API_KEY`; production environment execution is refused. An enabled rehearsal defaults to `local`, so an existing API key cannot silently select cloud extraction. No key or raw request header is logged. Record the actual engine/model rather than assuming the voice model and capture model are the same. Capture errors retain the missing-fact recall denominator and make the run fail; they do not become skipped test cases.

The runner strips oracle metadata from implementation input, calls the candidate extraction/validation path, and projects the record through planner/contact/intake builders and `buildEvanEmailBundle({ captureRecord })`. In `--local` and `--live` modes, any failed or `needsReview` result produces a nonzero exit code. A fixture test that exercises only a separate, unused extractor is not enough.

### Automated scoring boundaries

The current deterministic scorer is intentionally conservative. It uses explicit field/category/state/location matching, a small general comparison alias set and limited plural normalization, canonical phone/name/email handling, quantity-kind/bound comparisons, one-to-one entity matching, source-turn overlap, empty-category controls, excluded/removed-value checks, and current route-order checks. Ownership and responsibility-bearing pronouns are preserved as distinct visitor/provider/third-party roles; they are not discarded as stop words. It atomizes required counts and qualifiers rather than assigning one point to a long paragraph. Unrecognized or partially matching paraphrases are `needsReview`; extra emitted facts without a decisive oracle match are also `needsReview`, not automatically false and not automatically correct.

`lowerBound` treats `needsReview` as unproven, and `upperBound` assumes those entries prove correct on adjudication. A missing denominator is `null`. Grounded precision is conservative coverage of emitted fact records, whereas recall and quantity fidelity use expected atoms; their denominators are intentionally different and must be disclosed. Quote grounding checks cited role/span. Semantic grounding additionally requires oracle-supported meaning and state, but it is not a general entailment theorem and cannot independently validate every implication inside a long free-text value. Strong claims still require reviewing the retained outputs and exclusions.

Correction scoring requires absence of the removed value and preservation of currently expected facts in that domain. It does not prove asynchronous tombstone handling. Parity checks planner/intake fact preservation, selected visitor/sales recap fields, and uncertain notes; ambiguous rendered paraphrases require review. It does not check actual delivery, browser layout, all privacy policies, or revision races. Repeated stability is normalized lexical record agreement, including route metadata when present; two consistently empty outputs are stable but incorrect. Metamorphic groups always require semantic adjudication and recall checks, not merely identical serialized records.

Reports include corpus, instruction, schema, actual request-system-prompt, response-schema, source-file, and tracked-diff hashes; configured/requested model; Node version; repeated record fingerprints; per-case/checkpoint expected/observed atoms; failures/reviews; and all generated consumer projections. Source-file changes during a run are flagged. An untracked file outside the hashed source list is not covered by the tracked-diff hash, so preserve the candidate snapshot separately when freezing it. `qualityClaimAllowed` is always false in machine-generated reports: human adjudication and hard-gate review are required. The separate `automatedAssertionsClear` flag reports whether a live, unchanged-source run has no automated failures/reviews; it does not establish production reliability or represent a release approval. Offline mode always leaves it false.

Run the already existing local release suite as a separate regression check:

```powershell
npm run test:evan:release
```

Passing that suite does not substitute for executing the varied corpus, and a structural JSON validation must not be reported as a capture score. Do not run the `anam:smoke:*`, persona-update, model-update, or email-send commands as part of this evaluation.

## Result artifact and review

Create a new append-only, versioned evaluation report rather than overwriting existing operations scorecards. Include candidate revision/diff identity, corpus hash, split exposure history, harness/matcher version, extraction mode, date, command, and environment. For every case/checkpoint retain expected and observed normalized records, per-consumer projections, evidence references, atom-level failures, and any manual adjudication. Keep rendered output excerpts so parity assertions are auditable. Synthetic data permits precise diagnostics without exposing customer records.

Lead the report with whether hard gates passed and what failed, then provide recall/precision/grounding/parity tables and representative development failures. Do not publish holdout text to implementation authors before the freeze; after evaluation, failures may be disclosed together with their loss of holdout status for further tuning.

The reviewer should be able to answer these questions from the report alone:

1. Which exact code/configuration was evaluated, and was the holdout clean when it was frozen?
2. Did unknown furniture and natural contact bundles reach the actual planner and email outputs?
3. Were false facts prevented, or did the system merely capture more words?
4. Did counts, bounds, entity identity, certainty, and endpoint scope survive normalization?
5. Were changed/removed facts gone at the right checkpoint and in every current projection?
6. Were agent suggestions, third-party contact, and hypothetical examples kept out of confirmed scope?
7. Were event-order and final-transcript behaviors exercised through the production merge path?
8. What remains untested or unsupported, and what production reliability claims are not justified?

This plan and corpus add evaluation evidence only. They do not change product behavior, promote a candidate, replace prior evidence, or authorize a live test.

## Local verification recorded on 2026-10-21

`work/evan-6097-promotion/capture-evaluation/offline-development-20261021-002.json` records the final offline-only run of 36 development cases, seven development prefix checkpoints, and two repetitions: 86 synthetic empty-provider executions. There were zero execution errors and no hashed-source changes during the run. The corpus structure check passed for all 52 entries and nine total checkpoints without executing or printing holdout conversations. Thirteen scorer assertions and four independent, hand-authored shared-record projection assertions passed. The latter exercised planner/intake and visitor/sales email wiring, not extraction prediction. The earlier `offline-development-20261021-001.json` is preserved with its original source hashes and nine scorer assertions.

A read-only adversarial review found that removing pronouns during token matching could award full credit when packing responsibility changed from the visitor to the provider. The scorer was corrected to retain role distinctions, and that independently supplied probe is now a regression assertion. This catch reinforces the need for conservative bounds and human semantic adjudication rather than treating token overlap as proof of meaning.

The empty-provider baseline correctly misses almost every positive fact and therefore has many deliberately failing case outcomes. Those numbers are a check that the scorer penalizes missing capture, **not measurements of the configured extraction model**. Only `offline-empty-stub` was invoked; zero external requests, holdout runs, live sessions, deployments, or sends occurred. Extractor semantic accuracy, clean holdout generalization, and live readiness remain unmeasured.

## Independent-review follow-up evidence

`offline-development-20261021-003.json` preserves the reviewed v2-contract run: 86 development/checkpoint/repeat executions, zero execution errors, no external model calls. Historical reports remain unchanged. Required literal `scope` now distinguishes source-backed item groups; it is part of schema and record fingerprints, not oracle metadata supplied to extraction.

The reviewed scorer version is `ordered-entity-v2`. Ordered semantic comparison prevents several demonstrated responsibility/polarity reversals from receiving automatic credit. Tentative quantities remain in their denominators. Projection checks bind full labels, quantity, role, scope and uncertainty to the individual entity across applicable planner/intake and visitor/Admin/Sales text. Reports explicitly state partial coverage and omitted dimensions; a perfect checked-pair score is not exhaustive parity or a readiness approval. Thirteen independent mutation tests supplement the 13 internal scorer checks and four supplied-record projection checks.

The local release run passes 403 regression checks plus 107 capture/scorer checks, including the actual player-event adapter for old partials, revised finals, source chronology and unchanged close authority. These tests address event mechanics and supplied-record projection, not runtime extraction quality. Real model accuracy, latency and clean holdout performance remain unmeasured under the user's local-only restriction. See `EVAN_CAPTURE_LOCAL_REVIEW_2026-10-21.md` and the latest follow-up in `EVAN_CAPTURE_REDESIGN_2026-10-21.md`.
