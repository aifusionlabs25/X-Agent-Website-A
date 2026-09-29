# Bounded planner comparison — prepared locally, not run

Owner authorization: `C:/Users/AI Fusion Labs/Downloads/JAMES_AUTHORIZE_PLANNER_NEUTRAL_COMPARISON.txt`.
Baseline: `bad87a27b9185577fa7feffa846d796a26a2e975`.
Isolated branch: `codex/james-planner-comparison-20260929`.

Baseline prompt SHA-256: `22256e741fb60f8548efdf22200024f145c5f32703460331d4bbf711443404ce`.
Common neutral prompt SHA-256: `6c0f139216a8bce8477b1df81e145e37eb028c050b3ccc9d67ce7e12ac8ce528`.
The common prompt is staged only. Four exact planner-dependent spans changed; all other prompt text is unchanged.
Private rollback/configuration artifacts and access capabilities are under ignored `.vercel/comparison/`. Do not publish or print the capabilities.

Readback confirms persona `ff9c480e-44d1-4a8c-8ae6-b5666fd2a92d`, Jerry B. voice `5ea79b27-25e5-52d9-bab8-944038935c40`, model ID `85906141-db1c-4927-b74d-3c82ebe2436e`, and `james_handoff` awaitResult=true / timeout=15 seconds. Knowledge and tools are unchanged. SDK 4.20.0 is unchanged.

## Treatment and observations

- ON: identical baseline tool-result JSON.
- OFF: same facts, uncertainties, readiness, confirmations and action truth; host next-question/stage and equivalent speaker directives removed.
- Both arms: same parser, storage, readiness, lifecycle and action gates; same staged neutral prompt. No owner email grant accepted on this preview.
- Owner-only per-arm access, one durable session reservation per arm, no retry. Comparison activates only for the explicit preview environment flag.
- Minimal client diagnostics record finalized/enqueued/committed turns, handler queue wait, exact tool result plus hash, source-turn match, native data-channel send attempt/return/error, SDK local completion/failure, full assembled replies and closure. These do not establish provider consumption; that remains NOT_OBSERVABLE.
- No SDK session, deployment, prompt publication or email has occurred. Neither arm has actual exposure or behavior evidence.

## Offline verification

8 comparison tests pass; 24 existing compound-evidence/lifecycle regressions pass. TypeScript and diff whitespace checks pass. Targeted new-module lint passes. The existing canary `<a href="/">` lint finding is pre-existing and was not repaired.
An initial test assertion incorrectly matched the preserved safety phrase “Use only accepted contact fields”; the assertion was narrowed to planner directives. No parser or safety relaxation was made.

`state.ts` matches the baseline Git blob `612e221d23e4d26d4abe5babed086224d74ac692` exactly. Existing dirty work remains in `james-hosted-canary-20260927`, not this branch:

- `lib/james-canary/state.ts`: SHA-256 `0ae43f1ed6a1c676da03211c0ad69bc030ab9d2ae8f894bbd9591622aaedd1b7`.
- `tests/james-native-outcome-trace.test.mjs`: SHA-256 `58db997fc69d585565cd9a55da4cc4e34211c8de550167349cf81a5849d0b3b0`.

## Blocking prerequisite

Vercel CLI sign-in is now verified as `aifusionlabs-8387` after Rob approved device code LGFH-LMSV. No credential value was printed.

The comparison branch lacks the three storage settings. Read-only metadata shows the same keys already exist as sensitive Preview variables scoped to `codex/amy-anam-conversation-reliability`; no matching Team Shared Environment Variables exist. Vercel documents that shared environment variables cannot be branch-specific, so linking one would affect every linked project/environment and is unsuitable here. No value was decrypted or exported, no settings were moved, and no Amy session keys were accessed.

James persists session records under `xagent:james:canary:v1:`. Its existing start rate limiter is imported from `lib/anam/session-spine-store.ts` and increments only `xagent:amy:anam:rate:v1:<James request fingerprint>` with a short TTL. That is a James request counter, not an Amy session record. This bounded shared-helper behavior is the only Amy-prefixed storage touch on the James session-start path.

One owner action is required: in Vercel project `x-agent-website-a` → Settings → Environment Variables, copy only the existing values for `AMY_ANAM_SESSION_SECRET`, `AMY_ANAM_REDIS_REST_URL`, and `AMY_ANAM_REDIS_REST_TOKEN` from Preview branch `codex/amy-anam-conversation-reliability` to Preview branch `codex/james-planner-comparison-20260929`. Keep both source and destination branch scopes exact. Do not paste values into chat or alter Production/other branches. The two session-spine gate flags will be supplied only to the isolated deployment. No database or team-shared setting is needed.

Readback after these checks still matches the baseline prompt SHA, Jerry B., awaitResult=true and timeout=15. The two excluded dirty files retain their recorded SHA-256 hashes. No deployment, prompt PUT, session, inference or email occurred; restoration is not required because nothing was published.

After the branch-scoped config copy, use ONLY an isolated preview of the linked existing project, with `JAMES_PLANNER_COMPARISON=james-planner-20260929`. Verify hosted access and current config before the temporary prompt publication. Rob supplies genuine microphone speech; do not substitute text or fake events. End ON on repetition but run OFF if integrity/safety allow. Never patch between arms.

After testing, close both sessions through existing SDK/provider-release gates, preserve diagnostics, disable the experiment's start gate and restore only the comparison-owned prompt. The publication helper requires exact hashes and preserves all non-prompt fields. Verify restoration. Do not change any unrelated owner settings.

Recommendation at this checkpoint: complete the single branch-to-branch configuration copy above, then run the already-authorized paired comparison without parser changes. No ON/OFF exposure, behavior conclusion or READY claim is supported yet.
