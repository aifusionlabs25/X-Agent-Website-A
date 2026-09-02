# Amy discovery and follow-up correction — 2026-09-02

Public entry: https://xagent.aifusionlabs.app/agents/amy

## Scope

- Retain the visitor's business objective through summary requests and farewell.
- Capture case-management, visitor-identified data, reported ownership, unfinished requirements, and separate workshop/project targets.
- Keep requirements to discover separate from confirmed constraints. A proposed workshop is not a booking or validated implementation deadline.
- Require display-tool receipts before claiming an open view was updated. Tool-authored topics cannot inject customer facts.
- Treat an email-summary request as delivery intent, not a request to end the conversation.
- Include the corrected facts in all three existing email presentations. No new attachment/export promise or delivery mechanism.

Only the published Amy Cara 4 persona's managed prompt changes. Avatar, voice, Qwen model, greeting, KB, tool definitions, memory, consent, check-in, routing, Meeting Concierge, and delivery providers stay unchanged. No Dani/Evan configuration changes.

## Verification

- Nine anonymized workshop replay regression tests; existing Amy live-QA tests pass.
- Production build, lint, TypeScript, and 38 email tests pass.
- Main Anam suite: 401 pass, 1 skipped, 2 pre-existing Windows CRLF-sensitive Dani KB hash failures. Normalizing those 13 unchanged files to LF in memory reproduces every expected manifest hash; no Dani files were modified.
- Chrome preview: roadmap revision reflects both targets; finalized email retains substantive facts. Phone-width email content has no horizontal overflow; Insight logo loads.
- Temporary preview route and local-only build configuration were removed before release.

Live voice behavior and inbox receipt still require a fresh post-release session; deterministic replay is not an audio-quality or deliverability measurement.

## Release and rollback

The guarded Amy updater must verify the live persona and complete tool/persona inventories, back up outside the repository, preserve protected configuration, and prove other personas unchanged. The runtime manifest pins the resulting prompt hash.

Coordinate the website release and Anam prompt update; do not bypass readiness checks. Rollback must restore both the prior website revision (`100a6ef`) and the backed-up Amy prompt together, not one side only.
