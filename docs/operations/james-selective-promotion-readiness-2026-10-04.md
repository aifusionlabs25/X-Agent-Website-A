# James selective-promotion readiness — local only

No deployment, public alias change, Anam persona mutation, or provider session was performed for this preparation.

## Pinned source and scope

- Current public deployment source and rollback commit: `9291d2c3f2070eb9ed31c8b3a4d595afa67d4d86` (`main`). The active `x-agent-website-a` Vercel production deployment was read as `dpl_3DwLmPWgkug3vWzm9ozD4sMNjP8o`, with the custom-domain alias `xagent.aifusionlabs.app`.
- Frozen bounded candidate source: `cbbc24c3b8d1c932783d692778e37237e5477efe`. The configured Anam persona's system-prompt hash, version, and length matched this checkpoint's prompt fixture in a read-only comparison. This does not prove the exact runtime bytes of every earlier live session.
- This readiness branch starts from the deployed production commit and selectively carries the candidate runtime, shared intake/close changes, replay fixtures, and tests. The production tree and the frozen checkpoint are not edited.

## Proposed production behavior in this branch

- Existing `/demo/james` continues to re-export `/demo/james-notepad`. That page keeps its legal-pad UI and now uses a new browser storage key, `james-notepad-session-v2`.
- `/api/james-notepad` now uses `lib/james-canary/public-server.ts`: the bounded candidate persona, runtime-owned close, a new browser cookie `xagent_james_notepad_v2`, and a distinct encrypted-state namespace `xagent:james:notepad:v2:`. Existing v1 records, their cookie name, and the canonical Anam persona remain untouched. `lib/james-canary/demo-server.ts` remains available for rollback.
- No public James recovery route or James cron is included. If a provider session ends without normal browser-led closure, returning to the same browser while its signed authorization and encrypted session record remain available can reconcile the provider's final transcript and brief. The encrypted record expires 24 hours after its last save. **That 24-hour limit applies only to recovering an individual saved session; it is not a limit on James's availability for new sessions.** New-session availability still depends on the Anam and session-store configuration. If that browser is lost or never returns, there is no unattended or operator-triggered recovery in this release. The existing Amy/Dani recovery entries remain unchanged.
- The candidate's test-only `/demo/james-prompt-candidate`, `/api/james-prompt-candidate`, and recovery web routes are **absent**. The local production build's route manifest also omits them. Candidate-only helper code and offline fixtures remain as non-routed test inputs.
- No Anam persona is deleted or replaced. The public server verifies the bounded persona's prompt/tool/runtime binding before launch and fails closed on drift.
- The public James server keeps its structured intake brief but disables demo-email authorization, preview, and send at the route level. A protected Production email flag reading `true` cannot enable email on this release; the separate candidate demo retains its existing email behavior for later qualification.

## Verification performed locally

- Focused public-route and recovery tests: **11/11 pass**, including same-browser reconciliation and the 24-hour recovery-only availability boundary.
- Full James offline suite: **189/189 pass**.
- Public-route email-off regression: **3/3 pass**, including a simulated enabled email flag, retained structured brief, and rejected email endpoints. Independent AgentMail suite: **38/38 pass** with the no-worker offline runner.
- Repository-wide `npm test`: **blocked by checkout-only Amy/Dani knowledge fingerprint mismatches**. Its core constituent recorded 403 passes and four failures, all in unchanged Amy/Dani knowledge checks; the independent AgentMail constituent passed 38/38. Their committed LF blobs are checked out as CRLF in this Windows worktree; their files and Git blobs were not changed. This is not a passing repository-wide gate for the current worktree.
- TypeScript: `npx next typegen` followed by `npx tsc --noEmit` **pass**.
- Local optimized `npx next build`: **pass** with local worker permission; public James routes listed, James recovery and test-only routes absent. The standard `npm run build` prebuild contract was not rerun.
- Deployment-contract script: **pass in non-production mode only**. Its production-environment branch did not run because this was a local build.
- `git diff --check`: **pass**; the scoped diff is limited to James code/tests/readiness documentation plus removal of the James-only cron entry from `vercel.json`. Amy and Dani cron entries and source files are unchanged. The local readiness checkpoint is not pushed or deployed.

An earlier repository-wide test run on this branch passed after restoring exact committed Amy/Dani knowledge bytes in this isolated test worktree. A later checkout again has CRLF working bytes for those LF blobs. In this James-only revision, Amy/Dani files were deliberately left untouched, so the standard repository-wide command remains red for that known local checkout condition. This is not a James code failure, but the full gate must be rerun from a byte-accurate checkout before deployment authorization.

## Owner deployment decision and rollback

This branch is an **authorization artifact, not a deployment**. Before an actual production deploy, the owner must confirm the production session-store/signing configuration and the site-wide deploy contract. James no longer adds a cron or requires `CRON_SECRET` for its own recovery, although other site features may still require that secret. The connected Vercel integration returned 403 when asked to list production environment variables; values were not read or changed. The production-only deploy contract therefore remains unverified here.

If Rob later authorizes deployment, retain the currently active deployment as the rollback target. Rollback means restoring that deployment/commit and its original `/demo/james` and `/api/james-notepad` behavior; do not delete the bounded or canonical Anam personas and do not delete either session namespace. The v2 browser key deliberately does not auto-load a v1 saved session. A rapid rollback likewise will not automatically resume a v2 browser session on the v1 route; the owner must accept or mitigate that 24-hour session-continuity tradeoff before rollout. The protected Production James email flag no longer blocks the notes-only behavior of this branch, but production session-store readiness and the site-wide contract remain separate release gates.

No push, preview deployment, production deployment, promotion, alias change, or live test is authorized by this document.
