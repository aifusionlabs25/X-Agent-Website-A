# Evan stable rehearsal checkpoint — October 22, 2026

Status: **stable core-scenario rehearsal baseline, 3/3 qualifying passes**. Not a production release. User requested this checkpoint and a production-readiness assessment while leaving production untouched.

## Reproducible identity

- Local checkpoint ref: `codex/evan-stable-2026-10-22-run56` (local-only snapshot; do not push/promote automatically).
- Existing working branch: `codex/evan-6097-promotion`; pre-checkpoint base HEAD `bab6d71be29875f886afcc9cb62a50c2591e54bb`. Snapshot includes the existing uncommitted candidate source, tests and evidence without resetting the working directory or its index.
- Tested immutable deployment: `dpl_CfcDhN5mEhbnsgVPV1LchGELUH62`, READY with no aliases.
- Preview: https://x-agent-website-2sijvsy43-robs-projects-e72bad73.vercel.app/demo/evan (protected; temporary share links expire and are not the checkpoint identity).
- Vercel project `prj_bV8rj56Sxm9BnNSgTxp5DcHrPVvs`, custom preview environment `amy-ceo-rehearsal`.
- Candidate persona `6097c73e-b6ef-48c5-94c7-9a95d4863b99`, Qwen `qwen/qwen3.6-27b`, reasoning effort none; Cara4.
- Managed prompt SHA-256 `39ec515166edc8a88c305ba1e0274eb416e0aae3494e46101a298439bd5e0c2b`.
- Read-only live persona audit on checkpoint date: identity, prompt hash, model ID, avatar, voice, speech detection, exact five tool attachments and all nine knowledge documents pass. Knowledge group `c9ad40d1-05ba-4cd6-84b4-f9fa90b1a112`.
- Rehearsal flags: capture enabled, engine local, recovery namespace `evan-6097-candidate`. Cloud extractor off. Internal mail to AIFL, not Mullins. No credentials are included in this checkpoint.
- Current public production was rechecked: `dpl_532oXZx47MLz9UWBmRWkzDx4dqLF`, unchanged. Public deployment commit reported by Vercel: `eb3ce310a94acff6a98f9929f08f4a0c41f927c6`; that object is not currently available in this local worktree, so an up-to-date release integration comparison remains outstanding.

## Three-run evidence

| Run | Session | Implementation | Evaluate original | Outcome |
| --- | --- | ---: | ---: | --- |
| 54 | a756198c-d591-45c0-b98c-cf6fe76ae8b2 | 95 | 95 | PASS; comparison not fully blinded |
| 55 | d7c81adc-8551-42c6-bff9-61d5aa8ca837 | 100 | 95 | PASS; original blinded scores retained, approved-demo wording difference documented |
| 56 | 5e664af8-a539-4e19-a1eb-28a1d7a721cc | 100 | 100 | PASS; blinded comparison |

All meet the unchanged scorecard threshold (90 total, each category15+, no critical failure). Reports: `EVAN_2SIJVSY43_RETEST_EVIDENCE.md`, `EVAN_RUN55_EVIDENCE.md`, `EVAN_RUN55_IMPLEMENTATION_SCORE.md`, `EVAN_RUN56_EVIDENCE.md`, `EVAN_RUN56_IMPLEMENTATION_SCORE.md`.

Verified across this sequence: bundled contact/name and confirmation, live planner updates, fragile dishes plus other inventory, separate pickup/delivery property and access details, qualified date, all three recap bodies, actual two internal Gmail receipts, and first-request automatic close. Fictional visitor recap has provider acceptance, not a real customer-inbox receipt. Numeric2nd is exercised in run55; spelled second in54/56.

Local verification at the deployed repair: 744 Evan release checks; 599 broader checks passed with one opt-in provider skip; TypeScript, changed-file lint, local and remote builds pass. Forty targeted repair tests plus independent bounded review passed. This is not a universal accuracy guarantee or full edge-case certification.

## What remains before production

1. **Decide public-demo versus real Mullins pilot delivery.** Current approved rehearsal recipients are AIFL. Real Mullins delivery needs confirmed Admin/Sales inboxes and operational acceptance of the24–48h callback commitment. A public demo that still routes to AIFL needs an explicit, truthful demo mode; it must not masquerade as an actual Mullins handoff. No new consent checkbox is proposed; preserve Rob's existing intake decision and refusal handling.
2. **Make the production capture gate explicit in a separately reviewed release candidate.** `readEvanCaptureConfig` currently requires `VERCEL_ENV !== 'production'`; merely setting the capture flag in production would not enable the tested engine. Replace that rehearsal-only lock with a narrowly scoped, default-off production authorization and tests only when release preparation is authorized. Keep the local engine; do not enable a paid extractor.
3. **Resolve production email gates and verify configuration, without copying rehearsal blindly.** `readEvanAnamAgentMailConfig` blocks effective production sending when recipients remain the AIFL defaults. Explicit Evan gate values, candidate ID/prompt/knowledge readiness, signing/storage/mail availability and the intended recovery namespace must be reviewed. Never accidentally carry the candidate recovery namespace into the ordinary production queue.
4. **Integrate only the reviewed Evan changes with the current website release.** This is an older candidate worktree with shared player/session edits. Fetch/review current main, isolate the Evan delta, and rerun regression checks so publishing Evan cannot roll back Amy, James, Dani or newer website changes. Preserve this checkpoint as the tested baseline.
5. **Bounded release smoke checks, not another open-ended rewrite.** Verify guest/email entry, live capture and one actual controlled recipient-inbox recap on a production-configured staged build; include correction/refusal, manual end, and small-screen sanity checks plus recovery/duplicate-mail failure paths in local tests. The three baseline calls did not cover every browser, device, correction, interruption or provider outage. Any behavior-changing release fix requires focused revalidation.
6. **Prepare monitoring and rollback, then obtain explicit release approval.** Define capture-failure, session-close and mail-failure checks; confirm production cron recovery and kill switches; retain the current production deployment as rollback. Stage and verify the release build before domain assignment. Do not promote this protected rehearsal build as if environment snapshots were interchangeable.

## Nonblocking polish / hold line

Duplicate generic fragile care and the opening pleasantry under To confirm are documented cosmetic noise, not reasons to restart the completed baseline sequence. Run54's callback wording inconsistency did not recur in55/56. No prompt/model/audio tuning is warranted merely to polish an accepted baseline.

The local checkpoint preserves source/configuration manifests and evidence, not provider secrets or an immutable backup of Anam itself. Re-audit live persona and knowledge before any future release. No production mutation, additional test, scheduled automation, or external push is authorized by saving this checkpoint.
