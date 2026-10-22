# Evan live-test benchmark v1

Effective: October 21, 2026. Owner: Rob. Reviewers: the implementation chat and Evaluate live testing for X agents.

## Current candidate after the authorized run-47 repairs

Use `https://x-agent-website-he64svj9h-robs-projects-e72bad73.vercel.app/demo/evan` for the next user-directed test, with its protected share link. Deployment: `dpl_Cdtbj1wzvsfEeJoqs9LtsMn5VCuo`. Only bundled-name capture, love-seat/desk capture, and the "Got it." close-prefix defect changed; prompt, knowledge, model, audio configuration, and the scorecard below did not. See [verified repair checkpoint](EVAN_RUN47_REPAIR_CHECKPOINT.md).

Current same-version streak: **0 of 3**, awaiting the first live test on this repaired code preview. The older baseline and run results below remain historical evidence, not the current testing URL. The existing rule to hold a version fixed throughout each consistency sequence still applies. No live call starts from this update alone.

## Accepted baseline

Run 46 is a user-accepted overall PASS. Rob listened live, accepted the opening overlap and the approved 24–48-hour demo follow-up wording, and confirmed receipt of the emails. Preserve those decisions in the report. They are not failures or deductions for this run. Actual rehearsal recipients remain AI Fusion Labs; an accepted demo script is not evidence that real Mullins staff received a message.

Baseline deployment: `https://x-agent-website-kbuc3dfp3-robs-projects-e72bad73.vercel.app/demo/evan`.
Persona: `6097c73e-b6ef-48c5-94c7-9a95d4863b99`.
Managed prompt SHA-256: `39ec515166edc8a88c305ba1e0274eb416e0aae3494e46101a298439bd5e0c2b`.
Knowledge: the nine documents in `config/anam/evan/knowledge-manifest.json`.
Run-46 session: `fd7ce401-c5dd-4153-a4cd-9b110b564922`.

Keep this deployment, persona configuration, prompt, knowledge, scenario expectations, and established audio routing fixed for the consistency sequence. Do not create another candidate solely to polish a user-accepted behavior.

## Shared rating

Each reviewer scores the same five categories independently before comparing totals. Independent judgment does not imply independent recordings: label each piece of evidence as live human observation, tester UI observation, provider transcript, tool receipt, server log, or received email. Never infer voice quality or overlapping speech from text alone.

| Category | Maximum | What earns full credit in the planned scenario |
| --- | ---: | --- |
| Listening and discovery | 20 | One useful question, room for a real answer, no invented caller answer or repeat loop; responds to the caller's priorities. |
| Useful and accurate answers | 20 | Answers the service question directly; uncertainty is handled briefly; respects approved pricing, booking, and demo-script boundaries. |
| Live planner and move details | 20 | Relevant volunteered facts appear and update correctly; any scripted correction replaces the old value; map and panels remain usable. |
| Contact and follow-up | 20 | Bundled name, phone, and email are retained and confirmed appropriately; expected recap, Sales, and Admin emails arrive once at the configured rehearsal destinations. |
| Call completion and continuity | 20 | The call keeps moving without a stall requiring rescue and ends on the first clear closing request, with a farewell and verified session closure. |

Use the following anchors within every category:

- 20: The planned outcome is met; no unaccepted defect is observed.
- 15: Outcome met after one minor, successful recovery; no lost facts or operator rescue.
- 10: Outcome only partly met, or the caller must prompt the agent to repair its own substantive mistake.
- 5: Major disruption; the operator must rescue the interaction to reach an outcome.
- 0: Required outcome fails or is materially incorrect.
- Not observed: Leave ungraded. Do not turn missing evidence into either a pass or a failure, and do not normalize a partial total to 100.

The total is a scenario score out of 100, not a claim of general reliability or naturalness. The report must state evidence coverage. Any critical failure still fails the run even if other categories score well.

## Critical failures

- Repeating or paraphrasing a discovery question, asking another unrelated question, or inventing the caller's answer before the caller completes a real answer. A related inventory question can naturally ask about furniture and approximate boxes together.
- A sustained stall that requires caller/operator rescue, an unwanted early disconnect, or failure to close after an explicit end request and the existing approximately ten-second allowance.
- Incorrect or lost consequential details, unauthorized duplicate messages, or a claim of completed action contradicted by its receipt. Approved fictional demo wording is judged under Rob's stated demo scope; reports must still describe actual delivery.

An audio/setup failure or missing observability is INVALID/UNGRADABLE, not an Evan behavior failure. Rob's deliberate stop must be recorded as an operator stop rather than a spontaneous disconnect.

## Consistency target

The initial working target is three consecutive valid passes on this exact candidate. Each run needs both reviewers at 90/100 or above, every category at least 15, adequate evidence, and no critical failure. Keep both scores visible; do not average away a disagreement or a failure. Differences of five points or more in a category, or any pass/fail disagreement, require a short evidence reconciliation.

Run 46 is accepted as pass 1 of 3. A valid failed run resets the pass streak. An invalid setup attempt neither increments nor resets it. A behavior-affecting candidate change starts a new sequence. Keep the core scenario comparable while allowing natural wording; only broaden to intentional interruptions or other stress scenarios after the baseline sequence is complete. Production release remains a separate decision.

No call starts merely because this document or a report is updated. Continue the existing user-directed test workflow.

## Opening recovery option, held for later review

If an early-speaking caller repeatedly causes a real restart in later tests, the proposed narrow prompt addition is:

> If the caller begins during your introduction, let them finish. Acknowledge the useful detail briefly and continue from it. Do not restart your introduction or ask them to repeat clearly heard information. For example: "Got it, thanks—Mesa to Tempe. What size home are you moving from?"

This is a proposed recovery rule, not a live prompt change. The baseline remains fixed while consistency is measured.

## Report block

Include the immutable deployment, persona/prompt identity, session ID, scenario, evidence sources, manual interventions, both five-category scores, both totals, any critical failure, Rob's acceptance notes, final disposition, and current same-version pass streak. Preserve any disagreement with the evidence that resolved it.

## Run 46 baseline comparison

Both reviewers scored before seeing the other's numeric rating. They used the combined evidence described above, including Rob's live acceptance and receipt confirmation.

| Category | Implementation | Testing |
| --- | ---: | ---: |
| Listening and discovery | 20/20 | 20/20 |
| Useful and accurate answers | 20/20 | 20/20 |
| Live planner and move details | 20/20 | 20/20 |
| Contact and follow-up | 20/20 | 20/20 |
| Call completion and continuity | 20/20 | 20/20 |
| Total | 100/100 | 100/100 |

Final disposition: PASS. Agreement: 5/5 categories. Critical failures: none under the approved scenario. Consistency sequence: 1 of 3 passes. Next: two comparable calls on the unchanged baseline, started through the existing user-directed test workflow.

## Run 47 comparison and current status

Session: `489d6940-a780-4b37-9afa-e4ddef5da986`, same `kbuc3dfp3` preview and matching session prompt hash. The two ratings were recorded independently before comparison. See [exact evidence](EVAN_RUN47_EVIDENCE.md) and [implementation rating](EVAN_RUN47_IMPLEMENTATION_SCORE.md).

| Category | Implementation | Testing |
| --- | ---: | ---: |
| Listening and discovery | 20/20 | 20/20 |
| Useful and accurate answers | 20/20 | 20/20 |
| Live planner and move details | 10/20 | 10/20 |
| Contact and follow-up | 10/20 | 10/20 |
| Call completion and continuity | 10/20 | 10/20 |
| Total | 70/100 | 70/100 |

Final disposition: FAIL, not an audio/setup-invalid run. Supplied name was lost from the planner and structured email identity; the planner reconstruction omitted the love seat and desk; the application refused the first explicit end request. Direct packing answer, phone/email confirmation, eventual close and the two internal recipient-inbox receipts were verified. The visitor recap was accepted by the mail provider for the fictional address; recipient-inbox receipt is not established.

At the run-47 assessment, the same-version streak was **0 of 3**. This superseded the previous next-two-calls status, not Rob's accepted run-46 score. The candidate and production were unchanged at that assessment. Rob subsequently authorized the three repairs; the verified replacement preview and current sequence are listed at the top of this document. Production remains unchanged.
