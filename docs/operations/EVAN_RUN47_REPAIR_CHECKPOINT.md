# Run 47 targeted repair checkpoint

Date: October 21, 2026 (America/Phoenix).

## Scope

Authorized: repair the three deterministic run-47 failures, verify, and send an isolated rehearsal preview to the Evaluate chat. Production remains frozen. Run 46's accepted score and run 47's independent 70/100 ratings are preserved.

1. **Bundled name:** a first-person introduction such as "Sure. I'm Jordan Avery. My phone is ... and my email is ..." now reaches the planner and guest email identity even when the preceding turn offered a recap rather than explicitly asking for a name. Planner and email extraction share the same bounded helper. Agent speech, third-party names, quoted examples, generic descriptions, and absent contact values cannot create this new identity match. Existing confirmation, correction, and removal handling remains intact; an unconfirmed full name stays marked for review in the internal lead extraction.
2. **Inventory:** the existing factual-inventory parser now recognizes love seat/love-seat/loveseat and desk, including plurals. Existing hypothetical, negation, speaker, and removal filters remain in effect.
3. **First close:** the close detector strips a completed "Got it." acknowledgement before applying its existing close rules. The exact run-47 request is accepted; "Got it" alone, ongoing requests, quoted/hypothetical requests, stale turns, and pending caller speech still do not authorize ending.

No prompt, knowledge, model, avatar, voice, audio routing, UI, email destination, email idempotency, or close-timer changes were made. Five application source files changed: one new bundled-name helper and four existing Evan parsing/close modules. Four regression-test files changed.

## Verification

- Exact run-47 regressions reproduced the three failures before the fixes.
- Focused contact/lead/inventory/close suites: 110 passed.
- Evan release suite: 394 passed.
- Full repository `npm test`: passed with normal Windows access. The initial sandbox attempt failed on unrelated temporary-file permissions; the normal-access rerun passed.
- TypeScript and changed-source ESLint: passed.
- Local optimized Next.js build: passed.
- The other 259 files under app, components, lib, and config have an unchanged aggregate SHA-256: `edc86af9c33a47c62a14632040fad6d1bf0705e21a5fbd0118b67e2cae7b41d3`.
- Candidate remains `6097c73e-b6ef-48c5-94c7-9a95d4863b99`, with managed prompt SHA-256 `39ec515166edc8a88c305ba1e0274eb416e0aae3494e46101a298439bd5e0c2b`.

## Verified rehearsal preview

- URL: `https://x-agent-website-he64svj9h-robs-projects-e72bad73.vercel.app/demo/evan`.
- Deployment: `dpl_Cdtbj1wzvsfEeJoqs9LtsMn5VCuo`, READY; CLI target `amy-ceo-rehearsal`; assigned aliases: none.
- Built from the existing Evan worktree on `codex/evan-6097-promotion` with the three scoped fixes. This is a local-source preview, not a new main-branch commit or production release.
- Vercel optimized build and type check passed. The protected website smoke passed guest and synthetic-email entry, signed-cookie persistence, candidate session-token issuance, and logout. No live engine or email was started by these checks.
- Public `xagent.aifusionlabs.app` still resolves to `dpl_532oXZx47MLz9UWBmRWkzDx4dqLF` / `x-agent-website-6je1fysvo-robs-projects-e72bad73.vercel.app`, unchanged from the pre-repair check.
- Browser access uses the short-lived Vercel share link sent directly to the Evaluate chat; deployment protection remains enabled. Refresh the share link if it expires instead of changing deployments or disabling protection.

Automated regression results are not a live-call score. The new code preview starts a new same-version consistency sequence at 0 of 3, using the unchanged shared scorecard. Retest the comparable scenario, including the bundled self-introduction, love seat and desk, and the exact first closing request. Inspect the live planner and all three email identities; distinguish provider acceptance from actual recipient-inbox delivery. Use the established user-directed test-start workflow and leave audio settings unchanged.
