# Evan 6097 public-demo release candidate

Status: owner approved publication after a successful manual test on November 13. Production staging and verification are in progress; the public domain has not yet moved.

Live verification update: the first November 13 public attempt was manually ended after Evan failed to progress beyond short acknowledgments. See `evan-duration-public-test-diagnostic-2026-11-13.md`; do not count that attempt as a timeout failure or successful release test. The subsequent owner-run session `76297577-e585-4410-9293-fbf521e65365` lasted 179.876 seconds, with a runtime limit of 180 seconds, the unchanged Run57 prompt, no end-session tool call, and no interruptions/errors/warnings. This strongly supports termination at the three-minute provider limit; the API supplies only `CLOSED_BY_ENGINE`, not a more specific reason. The two public-copy calls did not overlap. Owner reported normal conversation and approved this version for publication. This does not establish that automation caused the earlier failure: separate interrupted text-only diagnostics also reproduced short replies. The unsuccessful recovery-prompt experiment remains rejected and is not part of application runtime.

## Baseline and preservation

- Best full-call checkpoint: Run57 layout, `2bc24b18c555acb2dce1ed098d3cc932690976bc`, following three consecutive core passes in Runs54–56.
- Matching managed Anam prompt SHA256: `39ec515166edc8a88c305ba1e0274eb416e0aae3494e46101a298439bd5e0c2b`.
- Logical application identity remains `6097c73e-b6ef-48c5-94c7-9a95d4863b99`.
- Existing6097 and original4b personas remain unchanged. Two isolated provider copies carry the frozen checkpoint: public `3720fcf6-f9fd-4b7c-b384-af559d0c84b2`; private `3934e7dc-b966-44f3-b19b-a453f147d22c`.
- A separate historical planner tool prevents later experimental changes to the shared tool from entering this release. Other tool identities remain pinned; complete definitions are checked before token issuance.
- Run57 capture engine, planner/map, email implementation, and closing-core modules remain unchanged. Other agents' dedicated code and middleware match the current public release.

## Duration and access

- Public sessions: provider-enforced180seconds, visible countdown, final30second warning, browser fallback.
- Protected sessions: provider-enforced1800seconds. `/demo/evan/extended` exchanges a private access code for an origin-bound, HTTP-only signed cookie valid for onehour.
- Missing, expired or forged grants never upgrade public sessions. Request parameters cannot choose the provider copy or override duration.
- External Evan meetings require the same private grant and are capped at30minutes; ordinary email check-in does not bypass the public limit.
- Three-second UI tolerance applies only to server-initiated closure near the deadline. Earlier closes and transport failures retain existing diagnostics.
- These are **per-session** limits, not a cumulative per-prospect quota. Existing rate limits remain; an invitation/budget system would be separate work.

## Preview

- Candidate code: `397b330` on `codex/evan-6097-public-duration-20261113`.
- URL: https://x-agent-website-nqyf854rc-robs-projects-e72bad73.vercel.app/demo/evan
- Environment: `amy-ceo-rehearsal`; deployed with `--skip-domain`. No production or shared alias assignment.
- Capture: local deterministic engine; cloud extractor disabled.
- Recap, Admin and Sales email routing: AI Fusion Labs only. Check-in copy explicitly describes that demo routing.
- Private access code is stored only in ignored `.vercel/evan-duration-private-access.json` and the deployment's server environment. Do not commit or put it in a public URL.
- Provisioning receipt: ignored `.vercel/evan-6097-duration-release.json`.

## Verification and publication gate

- Evan release tests:749passed.
- New duration/provisioning/meeting/runtime checks:37passed.
- Broad cross-agent suite:635passed, one existing skipped test.
- TypeScript and changed-file lint pass. An existing AnamPlayer effect lint finding is unchanged.
- Both rehearsal builds succeeded remotely; final deployment is `dpl_6H5E1sgv5bGAJgFu13bE8bZfGtqZ`, READY with no aliases. Local Turbopack hit an unchanged James font-loader error; diagnostic Webpack build hit pre-existing CSS-module constraints. No dependency or other-agent edits were made to work around those local errors.
- First rehearsal guest/email entry checks passed through token issuance without a live call or email.
- Final browser checks passed: public three-minute notice; AIFL-only email disclosure; private code unlock; private30minute notice; switching back restores public180seconds. No call started. No provider share links exist for either isolated persona.
- Final deployed boundary verification passed on November 13 at 19:38 UTC and is recorded in ignored `.vercel/evan-duration-verification.json`: public 180 seconds, private 1800 seconds after valid code/cookie exchange, wrong-code 403, public external-meeting denial, ignored caller-supplied duration override, capture-enabled flag, and return to public mode after grant removal. Both lanes require nonempty provider tokens, tracked launch reservations, and session-spine enablement. The stricter verification script is a local test-only update; deployed application code remains `397b330`.
- Guest and synthetic-email check-in both passed on the final deployment, including signed-cookie round trips, token issuance, permission isolation, and logout. No live engine/call or email was started. The test tokens did not expose an inspectable persona configuration; exact provider mapping is covered by server-side frozen-checkpoint validation and local tests, not independently decoded from those tokens. Likewise, the AIFL disclosure flag is not proof of actual email delivery.
- The owner authorized a deployment-specific temporary review link for this final build. It lasts about23hours and does not bypass the separate private-demo code. No project-wide protection settings were changed; the final preview remains READY with no aliases, and the production domain still resolves to the unchanged deployment below.
- Owner approval and the manual public cutoff evidence now exist. Actual email arrival/final saved notes from that manual call and a live private call beyond three minutes have not been separately verified; do not claim otherwise. No additional paid calls or emails are being sent for publication checks. Automated checks prove configuration and entry boundaries, not universal conversational consistency.
- The contact screen now shows neutral wording while routing policy loads or fails, with email submission disabled until valid policy arrives. Guest access remains available. All existing styling and healthy-path wording are preserved; 10 new component checks cover pending/invalid/failed/true/false responses.
- Production rollback target remains `dpl_532oXZx47MLz9UWBmRWkzDx4dqLF`, source `eb3ce310a94acff6a98f9929f08f4a0c41f927c6`. No production settings, Anam originals, website domains, or stable refs were changed.

## Approved production staging

- Build with production settings and `--skip-domain`; verify before promoting that exact build. Never promote the rehearsal build with an assumption that its settings are production-ready.
- Enable `EVAN_CAPTURE_PRODUCTION_APPROVED=true`, keep the local engine, AIFL-only routing, public 180-second copy, and protected 1800-second copy.
- Override only Evan-prefixed settings. Preserve all shared production credentials, maintenance configuration, and the existing (unset) `ANAM_RECOVERY_NAMESPACE`; the rehearsal namespace must not change Amy/Dani recovery queues.
- No site-wide sign-in gate is introduced. Dedicated other-agent code is unchanged; the shared player retains the checkpoint's existing isolation fix preventing Amy instructions from being injected into other personas.
- Stable Run57/layout ref stays unchanged. The current owner approval concerns a public demo, not a guarantee that the earlier interruption-specific failure is solved.
