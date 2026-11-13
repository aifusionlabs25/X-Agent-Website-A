# Evan 6097 public-demo release candidate

Status: protected rehearsal only. **Not approved for publication.**

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
- Final deployed boundary verification is recorded in ignored `.vercel/evan-duration-verification.json` when completed.
- Still required before publication: controlled live three-minute cutoff with final notes/email observation, a longer-demo continuity check beyond three minutes, then explicit owner approval. Automated checks do not prove live audio, natural conversation quality, or actual email arrival.
- Production rollback target remains `dpl_532oXZx47MLz9UWBmRWkzDx4dqLF`, source `eb3ce310a94acff6a98f9929f08f4a0c41f927c6`. No production settings, Anam originals, website domains, or stable refs were changed.
