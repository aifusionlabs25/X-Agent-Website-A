# Evan run-52 capture repair — 2026-10-22

## Scope

User authorized property separation, pickup/delivery access labels, and false inventory fragments only; production and unrelated behavior remain unchanged. This builds on the existing candidate, not a production release. No persona, prompt, model, audio, email-routing, date grammar, or capture-engine changes in this repair. Local deterministic capture remains enabled in rehearsal; no cloud extractor calls.

## Repairs

- Recognize moving **out of / into** as separate origin and destination properties. Preserve endpoint-specific corrections and short answers to the preceding property question.
- Preserve an endpoint lead-in across a comma ("At pickup, there's ...") and associate each access detail with its own building. A same-sentence "and there are ..." continuation can inherit its explicit endpoint; unrelated sentences cannot.
- Classify building clauses before inventory/count splitting, preventing fragments such as "out of a," "into a," "there's," or endpoint headings from becoming possessions.
- Preserve genuine items within mixed answers, including unfamiliar names, quantity ranges, and property words within names (office partitions / doll house). Property suppression uses the actual item span, not a turn-wide word blacklist. Inventory count ranges no longer contaminate an adjacent access description; real between-floors access qualifiers remain intact.

## Local verification

- 30 targeted run-52 regressions pass: exact reported dialogue plus varied order, punctuation, grammar, short answers, corrections, negative access, inventory/building mixtures, and source ownership controls.
- Each targeted case uses the actual capture builder, schema/evidence validator, planner projection, and all three email bodies. Network access is blocked by the test fixture.
- Independent review reproduced four additional sibling failures before repair, then confirmed all 30 targeted cases and no remaining blocker within these tested variants.
- Evan release checks: **704 passed** (403 + 301), zero failures. Broad repository suite: **599 passed**, one opt-in provider skip, zero failures. TypeScript, changed-file ESLint, and optimized build pass. Logs are in `work/evan-6097-promotion/run52-*.log`.
- Synthetic local checks are not a claim of universal capture accuracy or a live call pass. Next live test must validate both property types and their access labels, no false inventory, retained numeric date qualifier/contact confirmation, and normal close/email behavior.

## Candidate provenance and release boundary

- Existing candidate branch: `codex/evan-6097-promotion`, base HEAD `bab6d71be29875f886afcc9cb62a50c2591e54bb`, with prior uncommitted candidate work preserved.
- Current repair source: `lib/anam/evan-deterministic-capture.ts`; new regressions: `tests/evan-capture-run52.test.mjs`.
- Source SHA-256: `c95b5c241795cb048ecff1ae48344c003cd72d69acf75df82e666ad5f195cd84`.
- Regression SHA-256: `6adddd63b284dc7287018aa8a243ff68b9df95601d0a0f889c2a1be6bdd9041e`.
- Rehearsal target: `amy-ceo-rehearsal` (preview-type custom environment), project `prj_bV8rj56Sxm9BnNSgTxp5DcHrPVvs`.
- Deploy without domain assignment. Verify the immutable deployment and both entry paths before sending Evaluate the protected share link. Do not start a live call or send an email during smoke checks.
- Production baseline: `dpl_532oXZx47MLz9UWBmRWkzDx4dqLF`.
- Shared rehearsal alias baseline: `dpl_GcRLN42T3eMZfRNFpcQFLP42bXyq`.
- Run 52 remains NOT PASS; a new candidate begins at 0/3 consistency passes. Evaluate should wait for Rob's go-ahead, use the same practical scorecard, and score independently.

## Verified rehearsal handoff

- Deployment: `dpl_EbNsaPmZhBWgzpnEM6TPMzMpEXN2`, **READY**, `alias: []`.
- Immutable URL: https://x-agent-website-m56umlluq-robs-projects-e72bad73.vercel.app/demo/evan (protected; use the share link sent directly to Evaluate/Rob).
- Both guest and synthetic-email entry pass through cookie round trip, candidate session-token issuance, and logout. `evanCaptureEnabled: true` verified for both lanes. Two short-lived launch reservations created; no engine/live call/email started.
- Production and shared rehearsal aliases rechecked after deployment: both still point to the exact baseline deployment IDs above.
- Ready for a focused live retest, not production approval. Run the same practical scorecard against both property types and access associations; record screen evidence and all three recap outputs. Keep consistency at 0/3 until a qualifying call passes. Wait for Rob's explicit go-ahead and ensure no other voice session is active.
