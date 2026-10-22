# Run 51 numeric ordinal repair — October 22, 2026

## Scope

Only the ordinal alternatives in the deterministic capture timing expression changed: added `1st`, `2nd`, `3rd`, `4th`, `5th`, and written `fifth`. Existing `first` through `fourth`, `last`, and both “of” and “in” remain supported. Literal transcript wording is retained; no calendar date or year is inferred.

No changes to property capture, prompt, model, voice, audio, mail routing, or other agents. The local capture engine stays enabled and the paid extractor stays off. Existing unrelated candidate work is preserved.

## Verification

- 28 new date regression checks: 11 passed / 17 failed before the change; all 28 pass after it.
- Coverage includes numeric and written ordinal weeks with both prepositions, uppercase, all 12 months, exact run-51 wording, later correction, flexibility suffix, agent/callback/floor exclusions, and planner/three-recap parity.
- Combined replay retains `2nd week of November`, origin `2 bedroom apartment`, and destination `3 bedroom house` with distinct access details.
- All 674 Evan release/capture tests pass (403 + 271).
- Repository regressions: 599 pass, one opt-in provider test skipped.
- TypeScript, changed-file ESLint, and local production-style build pass.
- Independent read-only review found no in-scope blocking issue and independently reran the 28 tests successfully.

## Deployment and handoff

Verified preview: https://x-agent-website-wo63e2udh-robs-projects-e72bad73.vercel.app/demo/evan

Deployment `dpl_7GNDVk47zRT43eZED7cXp9C7Xw1n`: READY, no aliases, protected `amy-ceo-rehearsal` preview, remote build approximately 36 seconds. Local candidate checkout is based on `bab6d71be29875f886afcc9cb62a50c2591e54bb` with the existing uncommitted candidate changes, not a clean-commit release. Capture-source SHA256: `8739d8127fa3894a97ab66910de386c59761c7bd7e0bd1050d40251395e0e653`.

Guest and synthetic-email check-in passed through signed-cookie round trips, session-token issuance, and logout. Both token responses confirm capture enabled. No live engine, call, or email was started. Protected share URL supplied directly to Evaluate; access token is not stored here.

Production remains `dpl_532oXZx47MLz9UWBmRWkzDx4dqLF`; shared rehearsal alias remains `dpl_GcRLN42T3eMZfRNFpcQFLP42bXyq`. Do not infer live conversational success from unit tests or entry checks.

## Required next live-test coverage

Use the exact verified build supplied to Evaluate. Wait for Rob's go-ahead; no automatic call starts from this document.

1. State a route and “second week of November”; inspect the provider transcript and verify the full qualifier whether written as `second` or `2nd`.
2. Explicitly volunteer pickup `2 bedroom apartment` and destination `3 bedroom house`, even if Evan does not ask for the destination type. The prior run omitted that second fact, so separate-property preservation was untested.
3. Verify both properties and full timing remain visible together and appear in all three recap bodies.
4. Retain the existing scorecard and checks for inventory/filler, pickup stairs versus delivery elevator, contact readback/status, one question then wait, callback boundaries, first-request closing, and internal receipts. Mark unexercised cases not observed; provider submission is not inbox receipt.

This is a new candidate: same-version consistency begins at 0/3. No production release is authorized.
