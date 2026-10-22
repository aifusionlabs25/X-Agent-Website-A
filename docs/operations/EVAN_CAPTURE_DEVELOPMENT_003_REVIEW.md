# Evan deterministic capture: development report 003 review

Reviewed October 21, 2026 (America/Phoenix). Local-only, source-backed review. **Live testing remains on HOLD. This is not a release approval.**

## Evidence and unchanged scores

Source artifact: `work/evan-6097-promotion/capture-evaluation/local-development-20261021-003.json`.

The report ran the real local deterministic builder on 36 development conversations plus seven prefix checkpoints, twice: 86 executions. It recorded zero execution errors, 42 failed executions, 26 review-needed executions and 18 automatically passing executions. `sourcesChangedDuringRun` is empty. The frozen builder hash is `08febe63a9186e1bb4dbce0b9c450c0782297de70cd777e952a0c73aa851487e`.

| Automated measure | Proven / total | Conservative result | Awaiting review |
| --- | --- | --- | --- |
| Expected fact-atom recall | 312 / 400 | 78.0% | 28 atoms |
| Emitted-fact semantic support | 180 / 264 | 68.2% | 60 records |
| Quantity fidelity | 82 / 102 | 80.4% | 0 |
| Correction handling | 8 / 30 | 26.7% | 14 checks |
| Negative controls | 96 / 114 | 84.2% | 10 checks |
| Literal quote grounding | 264 / 264 | 100% | 0 |
| Declared projection checks | 1,172 / 1,172 | 100%, partial coverage | 154 omitted pairs |

This document does **not** rewrite the report, modify the corpus or scorer, remove failures from denominators, or claim an adjusted pass percentage. The findings below distinguish implementation defects from representation/matching limitations so that repairs target meaning rather than the test score. Checkpoints and repeated executions are not independent customer samples.

No holdout cases were read or executed for this review. No external model request, live call, email send, deployment, production mutation, audio change or Anam setting change occurred.

## Highest-priority genuine defects

| Case / stage | Visitor evidence and actual result | Assessment |
| --- | --- | --- |
| Development 09, removal checkpoint | After a bookcase is captured, “Take the bookcase off the list. It’s staying here.” leaves it asserted. The later reinstatement makes the final output look less wrong. | Real removal failure. Intermediate state matters; a final-only test would hide it. |
| Development 33, correction checkpoint and final | “Remove the sofa, and change the nightstands to one” retains two bedside tables and also creates a removed inventory record named “change the nightstands to one.” The later one-nightstand statement still leaves the count at two. | Real command-boundary and alias/correction failure. A command phrase is not an item. |
| Development 20, final | A possible Mesa storage stop is explicitly confirmed. The route becomes confirmed, but an unknown note still says “We may need a storage stop in Mesa.” | Real stale uncertainty: the same subject is both resolved and still shown for review. |
| Development 31, final | “What’s the safest way to move my 90-inch sofa? It’s on our move list, and the legs do not come off.” becomes a question plus an unknown note, with no inventory fact. | Real omission of explicitly included property and handling details. A question can contain genuine caller-owned facts; blanket question rejection loses them. |
| Development 32, final | “Phoenix to Mesa, one sofa and two lamps” fails to establish the route. A later targeted sofa removal leaves lamps and packing, but no route. | Real mixed-clause route omission; removing one item must not be confused with absence of route information. |
| Development 34, initial and final | Two same-city additional stops have distinct street addresses and purposes. Final output retains a Mesa storage stop but drops its supplied street address. | Real loss of stop identity/precision, even though the matcher marks some assertions `needsReview` rather than `fail`. City-only output is not equivalent to the known address. |

Development 09 also drops “There’s one more armchair in the den to add.” The requirement to preserve that additional group is genuine. Whether it should be represented as a computed total of three is a separate contract issue below.

## Genuine detail omissions, not harmless paraphrases

- Development 02–04 retain early November but omit flexibility on the date. Exact source quotes contain the flexibility; the projected value does not.
- Development 05 captures the hope chest but not its cracked-lid qualifier or requested care. An unknown note preserves the sentence for review, which is safer than inventing a fact but is not successful structured capture.
- Development 26 keeps the same dresser without duplicating it, but loses six drawers, solid oak and the approximate five-foot width. Correct item identity does not excuse qualifier loss.
- Development 27 retains a three-bedroom apartment but omits unit 12.
- Development 36 preserves the caller’s email and request for coordinator contact, but the record has no separate recap-refusal fact. This is a capture/communication-state omission, not evidence that an email was actually sent: delivery authorization is a separate existing path and was not exercised by this report.

## Representation and scorer limitations requiring a declared decision

These are not permission to relax the current safety contract or silently count a pass.

### Literal quantity versus inferred count

The current v2 record requires quantity text supported by visitor evidence; it does not invent a numeric total. Development 10, 11 and 30 expect one item from definite singular wording such as “the loveseat,” “the dining table” or “the workbench,” while the builder leaves quantity blank. That is a limitation of the chosen contract, not an incorrect claimed number.

Development 09 expects three armchairs by adding an initial two and a later “one more.” A correct future representation could preserve two source-bound groups and their distinct scopes without manufacturing a literal “three” quote. The current candidate does not preserve the extra group, so this case has both a real omission and an aggregate-count representation mismatch.

Do not fix either class by assigning unsupported `1` or `3` strings merely to make the scorer green. Any new inferred-count representation would need an explicit schema/projection design and independent tests.

### Unknown counts

Development 06 correctly captures bookshelves, dining chairs and plastic totes with blank quantities and retains “I haven’t counted those yet” as an unknown note. The expected field is an inventory-count uncertainty linked to those items; the actual uncertainty is a generic question note. This is not invented inventory, but the current representation lacks the requested entity association. It should not be advertised as complete count-state capture.

### Confirmation flags

`projectEvanCaptureContact` initializes `phoneConfirmed` and `spokenEmailConfirmed` to false and does not derive them from free-text capture facts. That conservative boundary remains intentional; captured contact text must not confer confirmation or delivery authority. Development 17 has a real **prefix contract gap**: after the caller confirms the original phone readback, the expected `phoneConfirmed: true` is still false (one failing assertion in each repetition). The final snapshot passes because a later replacement phone is correctly captured and expected to be unconfirmed. That final pass does not repair or erase the missed earlier confirmation state. This review does not claim that spoken readback confirmations are represented in the new shared record.

## Selected manual semantic adjudications

| Automated concern | Manual assessment of report 003 output |
| --- | --- |
| Development 22 flags “Loading bay reserved” as a forbidden fact. | False-positive exclusion match. Actual output is “The loading bay at delivery **must be reserved**,” preserving the requirement rather than claiming completion. |
| Development 22 reviews “Elevator available” / “Stairs” exclusions. | Actual values are “no elevator” at origin and “no stairs” at destination. The negated access facts are correctly preserved. |
| Development 21 reviews removal of November 18. | Actual move timing is November 20; the old date is absent, and callback weekdays after 5 pm remains separate. The semantic correction is correct despite matching ambiguity. |
| Development 02–04 / 24 review self-packing wording. | “We’ll pack everything ourselves,” “We’ll take care of all the packing,” and “we’ll handle packing ourselves” correctly assign packing to the customer. The broad packing responsibility is captured; any other missing date facts still fail. |
| Development 23 reviews crew packing scope. | Actual output separately keeps customer packing bedrooms/living room and crew help for dishes/glassware. The original whole-home crew-packing statement is gone. The generic service label “packing” needs the detailed scope beside it but is not proof that full packing survived. |
| Development 18 reviews no-follow-up wording. | The contact fields are removed and the literal “I don’t want any follow-up” remains. This preserves the opt-out. An extra unknown note repeats that same preference and is unnecessary clutter. |
| Development 36 reviews coordinator-email preference. | “contact me by email” is faithful to the stated coordinator preference. It does not, however, replace the missing separate refusal of a recap email. |

These adjudications are qualitative findings tied to the frozen report. No total was recomputed. The full corpus still has real errors, and perfect source-quote containment cannot prove correct ownership, certainty, correction state or completeness. The planner and emails can agree on the same wrong record.

## Independent workflow evidence alongside report 003

The independent local workflow suite was expanded from 22 to 24 tests using the recorded Run 47 wording and separate unfamiliar-noun continuation controls. Before repairs, the added tests exposed complete omission of the “how many boxes” answer and a spurious item named “There’s also.” After generic grammar and callback repairs, the unchanged 24 tests and test-file ESLint passed.

Actual output was also inspected, not only test assertions. The Run 47-shaped replay retained four item groups (approximate box range, queen bed, love seat, desk), the supplied route/date/home size, bundled name/phone/email, and requested callback tomorrow. Dish-packing/cost remained questions rather than ordered services. These facts survived mid-call prefix and final replay through the real record, planner, intake and all three locally prepared email bodies. This is not evidence of actual browser rendering or email delivery, and it does not override the broad failures above.

## Readiness decision

Not ready to unpause live testing on report 003. The next bounded repair should address real intermediate correction/removal errors, unresolved route state, mixed route clauses and stop identity before another frozen local evaluation. Preserve these scores and observations when comparing that next candidate. The untouched holdout should remain separate until the development candidate and scoring/representation rules are settled.
