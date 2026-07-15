# Amy stable Cara 4 canary

## Plain-English purpose

Amy's public Anam persona remains unchanged on Cara 3. A separate Anam persona lets us compare stable Cara 4 safely and roll back instantly by removing one preview environment variable.

The website keeps the normal public route:

- Public/control: `/demo/amy?qa=1`
- Cara 4 canary: `/demo/amy?qa=1&variant=cara4`
- Cara 4 voice bridge: `/demo/amy?variant=cara4&audioBridge=voicemeeter`

The `variant=cara4` request is resolved on the server. It works only for Amy and only when `ANAM_AMY_CARA4_PERSONA_ID` is configured. Unknown personas and variants fail closed.

## Edge-to-Amy audio bridge

The voice bridge is an explicit Amy Cara 4 test mode. It does not affect public Amy, other agents, or QA mode.

Signal path:

1. Microsoft Edge plays ChatGPT Live through `VoiceMeeter Input`.
2. The VoiceMeeter virtual-input strip sends that audio to the B1 bus.
3. Chrome opens the voice-bridge URL above.
4. The page selects `VoiceMeeter Out B1` with Anam's native `audioDeviceId` option before starting Amy.
5. Chrome plays Amy through `Speakers (Realtek(R) Audio)`, not back through the same VoiceMeeter input, to prevent a feedback loop.

Verified Windows per-app routes on 2026-07-14: Edge output `VoiceMeeter Input`, Edge input `VoiceMeeter Out B1`, Chrome output `Speakers (Realtek(R) Audio)`. Windows may display Chrome's saved physical microphone in Volume mixer, but the bridge URL overrides the live Anam capture device to B1 through the SDK.

Do not add `qa=1` to the bridge URL. QA mode intentionally sets `disableInputAudio: true` and remains text-only. If Chrome cannot see B1, the bridge stops with a visible error instead of falling back to a physical microphone. The green status badge changes from finding B1, to selected, to connected.

## Source Amy snapshot

Snapshot checked on 2026-07-14 before canary creation:

- Public persona ID: `8c7d5b42-b17e-4321-8bfa-381c8d93820f`
- Public avatar model: `cara-3`
- Avatar supports: `cara-3`, `cara-4`, `cara-4-latest`
- Stable canary model: `cara-4`
- Source prompt SHA-256: `4f3a64542c79fee42896d513a9cc85c3a37d9b289fe9e86dd75e3eece5fff75e`
- LLM: GPT OSS 120B
- Attached tools: three, including the existing Insight knowledge tool

The canary creation script fetches Amy's current live prompt and configuration, appends the provider-neutral behavior upgrade in `config/anam/amy-cara4-behavior-upgrade.md`, creates a separate persona, and verifies the avatar, voice, LLM, tools, settings, and prompt hash. It will not overwrite a mismatched existing canary.

Canary created and verified on 2026-07-14:

- Canary persona ID: `0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08`
- Avatar model: stable `cara-4`
- Upgraded prompt SHA-256: `adddfbcad0aeba5d66dbeb18f7b4db0f6a01317a063b84720aa6b49cdbaa1b4b`
- Same source avatar, voice, GPT OSS 120B LLM, and all three tool attachments: verified

## Safety boundaries

- The current public Amy persona is never updated by the script.
- Tavus files and the Tavus deployment are read-only inputs and remain on hold.
- QA mode disables microphone input. Both QA and normal voice mode use the same server-owned Cara 4 session spine.
- Cara 4 never sends its browser-assembled transcript to `/api/save-transcript`. The server binds the Anam `SESSION_READY` ID to a signed anonymous browser session, waits for Anam's session and transcript `endTime`, hashes the authoritative transcript, and stores only a content-free receipt.
- Phase 1 performs no Hermes, memory, AgentMail, Resend, Google Sheets, OpenAI, or other outbound automation work.
- Phase 2 may queue a pointer-only, post-session Hermes shadow review. The local worker fetches the authoritative transcript directly from Anam, redacts it in memory, and stores generated review content only in the operating-system temp directory. Vercel receives only status, hashes, and risk booleans.
- Phase 2 still performs no memory writes, tool calls, AgentMail/Resend sends, CRM/calendar updates, or other outbound actions. Those capabilities remain unimplemented and fail closed even if an enable flag is accidentally changed.
- Phase 4 adds only deterministic local review triage. It derives a suggested priority from the already validated human-review and quality-risk booleans; it does not make another model call, inspect generated prose, write a decision, or add a cloud field.
- Anam may briefly return a valid ended transcript with zero messages. Amy keeps that record recoverable for at least 30 minutes from both the later valid provider end time and the locally persisted completion receipt. Only two consecutive successful, still-empty observations at or beyond that boundary become the inert `transcript_unavailable` receipt; open sessions, partial transcripts, single empty reads, and retryable provider errors never use the silent-session cutoff.
- `cara-4-latest` is intentionally excluded because it is the experimental track.
- Director Notes are deferred. Stable Cara 4 and the SDK upgrade are evaluated first without adding another variable.

## Phase 1 session-spine environment matrix

Configure these values on the **Amy canary preview branch only**:

| Variable | Required preview value | Purpose |
| --- | --- | --- |
| `AMY_ANAM_SESSION_SPINE_ENABLED` | `true` | Requests the new server-owned path. |
| `AMY_ANAM_SESSION_SPINE_KILL_SWITCH` | `false` | Explicitly opens the canary gate. Missing or any other value fails closed when the spine is enabled. |
| `AMY_ANAM_SESSION_SECRET` | separate random value, at least 32 characters | Signs the anonymous browser ownership cookie. Never reuse `ANAM_API_KEY`. |
| `AMY_ANAM_REDIS_REST_URL` | preview Redis REST URL | Stores launches, ownership, completion intake, due work, and content-free receipts. |
| `AMY_ANAM_REDIS_REST_TOKEN` | preview Redis REST token | Authenticates server-only Redis calls. |
| `AMY_ANAM_RECOVERY_SECRET` | separate random value, at least 16 characters (32+ recommended) | Authenticates an external recovery scheduler. `CRON_SECRET` is also accepted for Vercel Cron. |
| `AMY_ANAM_RECOVERY_ENABLED` | `true` | Requests recovery processing on the canary. |
| `AMY_ANAM_RECOVERY_KILL_SWITCH` | `false` | Explicitly opens recovery on the canary. Missing or any other value fails closed. |
| `AMY_ANAM_PRODUCTION_PROMOTION_APPROVED` | `false` | Prevents a production cron invocation from doing provider reads or Redis mutations. Set to `true` only during a separately approved production promotion. |

The existing `ANAM_API_KEY` and branch-scoped `ANAM_AMY_CARA4_PERSONA_ID` are also required. Never use a `NEXT_PUBLIC_` prefix for any value above.

Gate behavior:

- `ENABLED` absent or not `true`: the experimental spine is off and existing agents retain their old behavior.
- `ENABLED=true` with a missing secret, Redis value, or explicit `KILL_SWITCH=false`: Amy Cara 4 returns `503`; it does not silently start an untracked canary session.
- `ENABLED=true`, `KILL_SWITCH=false`, and all server values present: the token response must include `sessionSpineEnabled:true` and a UUID `launchId`.

The completion endpoint persists `verification_pending` before it calls Anam, so closing the page cannot erase completion intake. Next.js `after()` is the preview fast path. The independent `GET`/`POST /api/anam/session/recover` route drains the Redis due-set when called by a scheduler. Each call is limited to eight records, two concurrent finalizers, and a 10-second dispatch window that leaves headroom for in-flight provider polling before the 60-second function limit. A global 55-second lease prevents overlapping drains, while the existing per-session lease also protects against completion/status requests racing the worker.

The recovery route requires its enable gate, open kill switch, and `Authorization: Bearer <secret>`. It accepts either `AMY_ANAM_RECOVERY_SECRET` or Vercel's `CRON_SECRET`. Vercel automatically sends `CRON_SECRET` to configured Cron routes. In production, the route additionally requires `AMY_ANAM_PRODUCTION_PROMOTION_APPROVED=true`; otherwise it returns `503` before doing work. `vercel.json` registers a Hobby-compatible daily call at 10:00 UTC (3:00 AM Phoenix time, with Hobby's hourly delivery window). This is a last-resort recovery backstop, not the timely retry path: `after()` and status checks remain the fast paths. A future QStash schedule or Vercel plan with minute-level cron is still required if the canary needs a shorter unattended recovery target. Cron runs only on production deployments, so preview validation is limited to manual authenticated route calls until an explicit production promotion.

## Phase 2 Hermes shadow environment matrix

Configure these values on the **Amy canary preview branch only**:

| Variable | Required preview value | Purpose |
| --- | --- | --- |
| `AMY_ANAM_HERMES_SHADOW_ENABLED` | `true` | Requests post-session shadow analysis. |
| `AMY_ANAM_HERMES_SHADOW_KILL_SWITCH` | `false` | Explicitly opens the shadow kill switch. Missing or any other value fails closed. |
| `AMY_ANAM_HERMES_SHADOW_MODE` | `shadow` | The only permitted processing mode. `active` is rejected. |
| `AMY_ANAM_HERMES_WORKER_SECRET` | separate random value, at least 32 characters | Authenticates the local worker bridge. Never reuse an Anam, Redis, or session secret. |
| `AMY_ANAM_MEMORY_ENABLED` | `false` | Keeps memory unavailable. |
| `AMY_ANAM_MEMORY_KILL_SWITCH` | `true` | Second fail-closed memory boundary. |
| `AMY_ANAM_TOOLS_ENABLED` | `false` | Keeps action tools unavailable. |
| `AMY_ANAM_TOOLS_KILL_SWITCH` | `true` | Second fail-closed tools boundary. |
| `AMY_ANAM_AGENTMAIL_ENABLED` | `false` | Keeps AgentMail unavailable. |
| `AMY_ANAM_AGENTMAIL_KILL_SWITCH` | `true` | Second fail-closed AgentMail boundary. |
| `AMY_ANAM_OUTBOUND_ACTIONS_ENABLED` | `false` | Keeps all outbound actions unavailable. |
| `AMY_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH` | `true` | Global outbound kill switch. |
| `AMY_EMAIL_PROVIDER` | `off` | Prevents the existing email path from being selected. |

The preview keeps the Redis credentials server-side. The local worker does not need them. Configure the local process with:

| Variable | Local value | Purpose |
| --- | --- | --- |
| `ANAM_API_KEY` | existing private Anam key | Fetches and verifies the authoritative transcript directly from Anam. |
| `AMY_ANAM_HERMES_SHADOW_ENABLED` | `true` | Mirrors the preview shadow gate. |
| `AMY_ANAM_HERMES_SHADOW_KILL_SWITCH` | `false` | Mirrors the preview kill-switch gate. |
| `AMY_ANAM_HERMES_SHADOW_MODE` | `shadow` | Prevents an active mode. |
| `AMY_ANAM_HERMES_WORKER_BRIDGE_URL` | `https://<preview>/api/anam/hermes/worker` | Claims pointers and returns content-free receipts over HTTPS. |
| `AMY_ANAM_HERMES_WORKER_SECRET` | same branch-scoped worker secret | Authenticates the bridge. |
| `AMY_ANAM_HERMES_HOME` | absolute isolated profile directory | Prevents Amy from inheriting the shared Hermes profile. |
| `AMY_ANAM_HERMES_PROVIDER` | `openai-codex` | Uses the already verified isolated Hermes provider. |
| `AMY_ANAM_HERMES_MODEL` | `gpt-5.5` | Uses the verified shadow-analysis model. |
| `AMY_ANAM_HERMES_PYTHON_COMMAND` | absolute path to the installed Hermes virtual-environment `python.exe` | Runs the pinned Hermes library without the unsafe CLI oneshot path. On this machine: `C:\Users\AI Fusion Labs\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`. |

Run one bounded claim with `npm run hermes:amy-anam-shadow -- --once`. The worker does not use `hermes --oneshot`: that CLI mode places the prompt in the process arguments, creates a session database, loads broader agent machinery, and auto-bypasses approvals. Instead, the worker sends bounded JSON over stdin to the pinned Hermes Python runtime and uses Hermes's narrow `openai-codex` auxiliary client. No tool schemas are supplied, no agent/session/memory/hook/plugin runtime is created, and the provider request is sent with `store:false`. The child receives a minimal environment with safe mode enabled and both hook acceptance and YOLO mode explicitly disabled.

A validated summary is written under the operating-system temp directory for at most 24 hours by default. The bridge acknowledgement contains no transcript, prompt, summary, recommendation, contact detail, or other generated content. `npm run test:anam:hermes-runtime` is the opt-in live proof: with `AMY_ANAM_HERMES_RUNTIME_INTEGRATION=1`, the isolated home, and the Python command set locally, it verifies that the prompt is absent from process arguments and every isolated-profile file, while `state.db` keeps the same hash, size, and modification time.

`GET /api/anam/amy/readiness` is a content-free, bearer-authenticated readiness view that reuses the worker secret. It reports the effective session, recovery, and Hermes gates and proves that memory, tools, AgentMail, and global outbound actions remain unavailable. `POST /api/anam/hermes/worker` uses the same bearer authentication, accepts a maximum 32 KiB JSON body, and supports only `claim`, `ack`, and `fail` operations.

## Phase 3 local human-review boundary

Run `npm run hermes:amy-anam-review -- --latest` to read the newest local Hermes result, or add `--all` to read every result still inside the viewer-enforced 24-hour temp window.

This is intentionally a local, read-only terminal viewer. It accepts only the worker's exact filename and output schemas, checks the content hash, rejects symlinks, hard links, changed files, future-dated files, expired files, and paths outside the operating-system temp directory, and removes terminal control sequences. Identifiers, contact details, URLs, secrets, and local paths found inside generated text are redacted before display. It does not load secrets, call the network, spawn a process, write a review ledger, or expose approve/apply/send/store controls.

The read-only capability design is the boundary; the banner `ANALYSIS ONLY - NO AUTHORITY` makes that boundary visible. A person can inspect the summary, recommendations, risk flags, and zero-action safety proof, but nothing produced by the viewer can authorize memory, tools, AgentMail, email, or any outbound action. A future tracked decision workflow requires a separate design and explicit approval; it must not be inferred from viewing a result.

## Phase 4 deterministic review triage

The local viewer now shows `Suggested review priority (rule-based, no authority)`. The value is computed in memory from fixed booleans after the existing filename, hash, retention, and output-schema checks:

- `HIGH`: Hermes explicitly requested human review, or the validated output flagged privacy, unsupported-claim, or pricing/inventory risk.
- `MEDIUM`: no high-priority reason exists, but a technical-term or repeated-question risk is present.
- `LOW`: none of those flags is present.

Reason codes use a fixed enum and fixed order. Summary and recommendation strings are not read by the triage rule. Priority is derived solely from model-produced boolean flags and remains a non-authoritative suggestion. The derived result is never written to the local packet, acknowledged to the worker bridge, stored in Redis, returned by the session status route, or used to trigger an action. `HIGH` means review first; `LOW` does not mean approved, correct, or safe.

The richer legacy intelligence fields such as top questions, pain points, and objections remain deferred. Adding them would require a versioned provider-output contract plus stronger provider-input redaction, egress enforcement, local-writer integrity, and independent physical retention before it can be considered safe.

## Validation ladder

1. Run `npm run test:anam`.
2. Run `npm run lint` and `npm run build`.
3. Confirm public Amy still starts in QA mode with no canary environment variable.
4. On a Vercel preview, compare public Amy and the Cara 4 canary with the same scenario.
5. In browser Network tools, confirm the Cara 4 token response has `sessionSpineEnabled:true` and a UUID `launchId`. A visually working Amy session without those fields is a failed spine smoke test.
6. Confirm `SESSION_READY` calls `/api/anam/session/bind`, closing calls `/api/anam/session/complete` with no transcript field, and `/api/anam/session/status?sessionId=...` reports `finalizationDurable:true` with `contentIncluded:false`.
7. Confirm Cara 4 makes no `/api/save-transcript` request. Verify a terminal status is `completed` or the explicit `transcript_unavailable`; investigate `failed` or a long-lived pending state.
8. Smoke-test one control agent, such as Taylor, because the SDK upgrade is shared by all X Agents.
9. Verify session startup, two-way text turns, interruption, visible framing, and tools/knowledge.
10. Invoke the authenticated recovery route with a due test record and confirm the summary is bounded, content-free, and `outbound:false`.
11. Confirm `/api/anam/amy/readiness` reports Hermes shadow open only on the canary while memory, tools, AgentMail, and outbound actions remain effectively closed.
12. Confirm an unauthenticated Hermes worker request returns `401`; then run `npm run hermes:amy-anam-shadow -- --once` with the isolated profile and verify a content-free `completed` or explicit retry result.
13. Run `npm run hermes:amy-anam-review -- --latest` and confirm it shows the local `ANALYSIS ONLY - NO AUTHORITY` packet without identifiers or any action control.
14. Confirm the viewer shows the deterministic priority and fixed reason codes; generated summary/recommendation text must not affect that result.
15. Confirm `/api/anam/session/status` reports `contentIncluded:false`, zero tools/emails/outbound actions, and no generated summary, priority, or transcript fields.
16. Verify a synthetic ended, zero-message transcript remains pending before 30 minutes and becomes `transcript_unavailable` only at the grace boundary.
17. Do not change the production Amy persona mapping until the comparison passes and an independent recovery schedule is configured and observed.

## Fleet sequence after Amy

Once Amy passes, repeat the same process one agent at a time: snapshot, duplicate, stable Cara 4 canary, preview comparison, promote or roll back. Do not mass-change all persona IDs at once.
