# Run 48 targeted capture repair

## Scope

Only capture interpretation, confirmation projection, and phone labels changed. Evan's prompt, model, voice, knowledge, conversation controls, email routing, and audio configuration were not changed. Production is untouched. Cloud extractor remains disabled.

## Changes

- Access details in combined pickup/delivery sentences are associated with their own location. Literal flight counts remain visible in the planner and all three email templates. A correction at one location leaves the other intact.
- Standalone speech fillers (`um`, `uh`, `erm`, `er`, `hmm`) are excluded from inventory lists; substantive item names are preserved.
- Phone readback confirmation is derived from the session transcript by the existing contact logic, not trusted from capture provider output. It survives capture validation and projection to planner/email labels only for the same current phone. A correction, removal, missing reply, or unrelated confirmation does not retain or invent confirmation.
- Confirmation does not grant new email/callback permissions or change recipients.

## Local verification

- 12 targeted regressions: exact run-48 wording, reversed locations, different flight counts, comma-separated details, location-specific correction, filler variations, legitimate nouns, bundled spoken-digit readback, and confirmation reset/negative cases.
- Evan release suite: 403 passed; capture suite: 231 passed (includes the 12 new regressions).
- Repository suite: 599 passed, one opt-in provider test skipped.
- TypeScript, changed-file ESLint, and production-style Next.js build passed.
- Broader previously documented capture limitations remain; no claim of universal interpretation accuracy.

## Candidate

Final isolated rehearsal preview: https://x-agent-website-co4450x6s-robs-projects-e72bad73.vercel.app/demo/evan

The earlier `ju36vtekj` build was superseded before handoff to retain the existing unconfirmed-phone warning in the fallback guest brief. Do not use it for this retest.

Local working-tree deployment based on `bab6d71`, not a clean committed release. Protected share access is handed directly to Evaluate. No production promotion or shared-alias reassignment is authorized.

Verified READY with empty aliases; remote Next.js build completed in approximately 40 seconds. Guest and synthetic-email check-in passed through token issuance with capture enabled. No live call or email was started by these checks. Production remains `dpl_532oXZx47MLz9UWBmRWkzDx4dqLF`; shared rehearsal remains `dpl_GcRLN42T3eMZfRNFpcQFLP42bXyq`. Exact protected preview and retest instructions sent to Evaluate; waiting for user-controlled live testing.

## Retest

Use the existing five-category scorecard. Verify origin/destination and one-flight detail in the live planner and final recaps, absence of filler items, and the phone label before and after explicit readback confirmation. Preserve conversation, dish-packing answer, bundled contact, email delivery, and closing checks. Distinguish provider submission to a fictional example address from actual inbox receipt. No automatic repeat or production promotion.
