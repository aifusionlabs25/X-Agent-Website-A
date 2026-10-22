# Evan public-demo release preparation — October 22, 2026

Status: locally verified release candidate; NOT published and NOT yet production-certified.

## Preserved baseline

- Stable ref: `codex/evan-stable-2026-10-22-run56`.
- Stable commit: `ac9835d6456fd330b2e3faa7bf65987acab657d4` (unchanged).
- Three qualifying rehearsal runs: 54, 55, 56. Their evidence remains in the checkpoint.
- Release integration base: `origin/main` at `eb3ce310a94acff6a98f9929f08f4a0c41f927c6`.
- Integration is in a separate managed worktree; the dirty original worktrees were not modified.
- Latest main's Amy invitation enforcement is preserved and tested. No prompt, model, voice, audio routing, or knowledge changes were made for this release preparation.

## New default-off release gates

- `EVAN_CAPTURE_ENABLED=true` plus `EVAN_CAPTURE_PRODUCTION_APPROVED=true` permits production capture only with `EVAN_CAPTURE_ENGINE=local`. Production cloud extraction remains blocked, even with credentials.
- `EVAN_PUBLIC_DEMO_ENABLED=true` requires an explicit `EVAN_PUBLIC_DEMO_MAIL_ROUTING` choice and AIFL-only internal recipients. Missing/invalid routing or non-AIFL internal overrides fail closed.
- Routing choices: `all-aifl` sends all three message copies to `aifusionlabs@gmail.com`; `visitor-recap` sends the visitor copy to their supplied address and both internal briefs to AIFL.
- No routing choice or production environment setting has been applied remotely. User clarification is pending on which visitor-copy behavior is intended.
- Existing provider, spine, outbound-action, and kill-switch requirements still apply. Demo mode never marks Mullins as the actual recipient. Existing demo disclosure in recap bodies remains intact.
- Guest demo lead sending also requires its existing explicit enable flag; this patch does not enable it by default.

## Verification completed locally

- Evan release suite: 745 passed at integration (404 + 341).
- Broader npm test: 626 passed, one opt-in provider check skipped (103 + 471 + 52).
- Focused final capture/email release tests: 14 passed, including actual mocked send destinations for rehearsal, all-AIFL, and visitor-recap, duplicate suppression, attachment sanitation, refusal handling, and partial-delivery wording.
- Amy invitation access suite: 23 passed, including disabled-gate and anonymous-request rejection.
- TypeScript and focused source lint passed.
- `npm run build` passed. This was a local optimized build, not a production-environment deployment. The existing production deploy contract correctly remains in place.
- No live call, real email send, production environment mutation, remote push, deployment, alias movement, or persona update was performed during this preparation.

## Still required before publish approval

1. Confirm visitor-copy routing choice. Internal Admin/Sales destinations remain AIFL either way.
2. Add/verify public-demo disclosure in the entry/exit experience appropriate to that routing; do not promise an actual Mullins handoff when mail goes to AIFL.
3. Verify deployed production configuration, secrets availability, candidate identity, and recovery namespace without copying rehearsal settings blindly. Production cron recovery must not be accidentally connected to the rehearsal queue.
4. Follow the main-only production deploy contract. Do not spoof branch metadata or push main merely to bypass the approval boundary. Agree on the staged release workflow before any action that could auto-publish.
5. Verify the staged artifact's entry, live capture, closure and controlled AIFL inbox delivery; local mocked delivery is not evidence of real inbox delivery in production mode.
6. Recheck the current production deployment before approval and record rollback target, then obtain explicit user publication approval. Baseline last observed production: `dpl_532oXZx47MLz9UWBmRWkzDx4dqLF`.

No additional live consistency test has been started. Evaluate's run 56 remains the accepted baseline, with both voice sides reported idle.
