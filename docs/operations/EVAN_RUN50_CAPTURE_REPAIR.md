# Run 50: date qualifier and separate property capture

## Scope

Two targeted capture changes only, relative to the run-50 candidate:

- Preserve literal week qualifiers with either “in” or “of”, including “second week in November”. Do not infer a year or calendar date.
- Use the immediately preceding property question to distinguish origin from destination, and preserve separately supplied property sizes. Split explicitly location-labelled property clauses without borrowing facts from the agent's question.

The shared captured record feeds both the planner and the visitor, Admin, and Sales recaps. No prompt, model, voice, audio routing, mail recipients, or production settings changed. The paid extractor remains disabled; capture is local/deterministic.

## Verification

- 12 new regression tests in `tests/evan-capture-run50.test.mjs`: date wording variants, date correction, run-50 property dialogue, destination-first dialogue, destination-only correction, combined property clauses, ambiguous/agent-only facts, and existing additional-stop behaviour.
- Evan release checks: 646 passing (403 release plus 243 capture).
- Repository tests: 599 passing; one opt-in provider test skipped.
- TypeScript, changed-file ESLint, and production-style local build pass.
- Replay verifies that origin “2 bedroom apartment” survives a later destination “apartment” answer in the planner and all three recap bodies.

## Rehearsal deployment

Build: `dpl_9Njguig3Nqz4zr44JGbkiqsn3uTf`

URL: https://x-agent-website-5lsbde7mr-robs-projects-e72bad73.vercel.app/demo/evan

Environment: `amy-ceo-rehearsal`, deployed with `--skip-domain`, capture enabled, local engine, candidate recovery namespace. Source is the existing dirty candidate checkout based on `bab6d71be29875f886afcc9cb62a50c2591e54bb`, not a clean-commit release.

Verified READY with no aliases. Production remains on `dpl_532oXZx47MLz9UWBmRWkzDx4dqLF`; the shared rehearsal address remains on `dpl_GcRLN42T3eMZfRNFpcQFLP42bXyq`.

Protected guest and synthetic-email entry both passed, including signed-cookie round trips, candidate session-token issuance, logout, and `evanCaptureEnabled === true`. No live engine, call, or email was started. Temporary protected access was supplied directly to Evaluate; the token is not stored here. Local checks and entry verification do not prove live conversational behaviour.

## Next test

Use one focused call on this exact build after protected access is verified and Rob gives the go-ahead. Exercise the second-week qualifier and different pickup/delivery properties; verify they remain visible and agree across recap emails. Retain the same scorecard and previous access, filler, phone-status, conversational pacing, and closure checks. No production promotion is authorized.
