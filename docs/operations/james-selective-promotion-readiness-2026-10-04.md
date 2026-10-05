# James selective-promotion readiness — local only

No deployment, public alias change, Anam persona mutation, or provider session was performed for this preparation.

## Pinned source and scope

- Current public deployment source and rollback commit: `9291d2c3f2070eb9ed31c8b3a4d595afa67d4d86` (`main`). The active `x-agent-website-a` Vercel production deployment was read as `dpl_3DwLmPWgkug3vWzm9ozD4sMNjP8o`, with the custom-domain alias `xagent.aifusionlabs.app`.
- Frozen bounded candidate source: `cbbc24c3b8d1c932783d692778e37237e5477efe`. The configured Anam persona's system-prompt hash, version, and length matched this checkpoint's prompt fixture in a read-only comparison. This does not prove the exact runtime bytes of every earlier live session.
- This readiness branch starts from the deployed production commit and selectively carries the candidate runtime, shared intake/close changes, replay fixtures, and tests. The production tree and the frozen checkpoint are not edited.

## Proposed production behavior in this branch

- Existing `/demo/james` continues to re-export `/demo/james-notepad`. That page keeps its legal-pad UI and now uses a new browser storage key, `james-notepad-session-v2`.
- `/api/james-notepad` now uses `lib/james-canary/public-server.ts`: the bounded candidate persona, runtime-owned close, a new browser cookie `xagent_james_notepad_v2`, and a distinct encrypted-state namespace `xagent:james:notepad:v2:`. Existing v1 records, their cookie name, and the canonical Anam persona remain untouched. `lib/james-canary/demo-server.ts` remains available for rollback.
- `/api/james-notepad/recover` exposes the runtime's authenticated provider-ended recovery; `vercel.json` schedules it twice daily. The existing Amy/Dani recovery entries remain unchanged.
- The candidate's test-only `/demo/james-prompt-candidate`, `/api/james-prompt-candidate`, and recovery web routes are **absent**. The local production build's route manifest also omits them. Candidate-only helper code and offline fixtures remain as non-routed test inputs.
- No Anam persona is deleted or replaced. The public server verifies the bounded persona's prompt/tool/runtime binding before launch and fails closed on drift.

## Verification performed locally

- Focused public-route and recovery tests: **9/9 pass**.
- Full James offline suite: **187/187 pass**.
- Repository-wide `npm test`: **pass** (all three constituent scripts completed with zero exit status).
- TypeScript: `npx tsc --noEmit --incremental false` **pass**.
- Local optimized `npm run build`: **pass**; public James and recovery routes listed, test-only routes absent.
- Deployment-contract script: **pass in non-production mode only**. Its production-environment branch did not run because this was a local build.
- `git diff --check` and final staged-scope check must be recorded after the readiness commit is assembled.

The initial repository-wide test run failed on unrelated Amy/Dani knowledge hashes because Windows `core.autocrlf=true` expanded checked-out LF blobs to CRLF. Their exact committed bytes were restored only in this isolated test worktree; the source blobs and proposed diff were not changed. The rerun passed. This is a local checkout condition, not a James code change.

## Owner deployment decision and rollback

This branch is an **authorization artifact, not a deployment**. Before an actual production deploy, the owner must confirm the production session-store/signing and `CRON_SECRET` configuration and Vercel cron eligibility. The connected Vercel integration returned 403 when asked to list production environment variables; values were not read or changed. The production-only deploy contract therefore remains unverified here.

If Rob later authorizes deployment, retain the currently active deployment as the rollback target. Rollback means restoring that deployment/commit and its original `/demo/james` and `/api/james-notepad` behavior; do not delete the bounded or canonical Anam personas and do not delete either session namespace. The v2 browser key deliberately does not auto-load a v1 saved session. A rapid rollback likewise will not automatically resume a v2 browser session on the v1 route; the owner must accept or mitigate that 24-hour session-continuity tradeoff before rollout.

No push, preview deployment, production deployment, promotion, alias change, or live test is authorized by this document.
