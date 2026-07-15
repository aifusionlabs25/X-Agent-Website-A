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
- Phase 2 still performs no memory writes, tool calls, AgentMail/Resend sends, CRM/calendar updates, or other outbound actions. Phase 6 adds separately consented, operator-approved returning-user memory; tools and outbound actions remain unavailable.
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
| `AMY_ANAM_MEMORY_ENABLED` | `true` for the memory test preview | Requires the Amy check-in before a Cara 4 session. |
| `AMY_ANAM_MEMORY_KILL_SWITCH` | `false` for the memory test preview | Explicitly opens the returning-memory boundary. Missing or any other value fails closed. |
| `AMY_ANAM_MEMORY_ACCESS_CODE` | separate test access code, at least 12 characters | Protects the test check-in page. This is not email ownership verification. |
| `AMY_ANAM_MEMORY_IDENTITY_SALT` | separate random value, at least 32 characters | Converts the normalized test email into an Amy-specific one-way identity before storage. |
| `AMY_ANAM_MEMORY_PROMOTION_ENABLED` | `true` for operator promotion tests | Allows a reviewed Hermes candidate to be submitted for a decision. |
| `AMY_ANAM_MEMORY_PROMOTION_KILL_SWITCH` | `false` for operator promotion tests | Separately opens the write path. Missing or any other value fails closed. |
| `AMY_ANAM_MEMORY_OPERATOR_SECRET` | separate random value, at least 32 characters | Authenticates the local operator decision. Never expose it to the browser. |
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
| `AMY_ANAM_HERMES_OUTPUT_RETENTION_HOURS` | `1` through `24` (default `24`) | Sets the local deletion threshold. Values above 24 are rejected rather than extended or silently accepted. |

Run one bounded claim with `npm run hermes:amy-anam-shadow -- --once`. The worker does not use `hermes --oneshot`: that CLI mode places the prompt in the process arguments, creates a session database, loads broader agent machinery, and auto-bypasses approvals. Instead, the worker sends bounded JSON over stdin to the pinned Hermes Python runtime and uses Hermes's narrow `openai-codex` auxiliary client. No tool schemas are supplied, no agent/session/memory/hook/plugin runtime is created, and the provider request is sent with `store:false`. The child receives a minimal environment; parent profile, proxy, custom-certificate, email, tool, and unrelated provider values are not inherited.

The runtime bypasses Hermes credential-pool selection, reads only the isolated local Codex access token, and refuses automatic OAuth refresh. It pins one HTTPS POST to `https://chatgpt.com/backend-api/codex/responses`, rejects redirects and proxy trust, requires normal TLS verification, disables SDK retries, and permits exactly one provider create/send. An expired token fails closed and must be refreshed by the operator outside Amy. Before the provider process starts, the server atomically records a content-free execution-start marker and extends the lease/due time to a fixed 10-minute grace, above the worker's fixed five-minute child timeout. A timeout, lost bridge response, expired execution lease, or other ambiguous post-begin failure is dead-lettered without retransmission. In receipts, `hermesExecutionHappened:true` therefore means execution was durably authorized and may have started; it is deliberately conservative and is not proof that the HTTP POST reached the provider. This is a strong SDK/HTTP boundary, not a Windows Firewall or process sandbox: malicious native sockets or compromised imported code remain outside its guarantee.

A validated summary is written under the operating-system temp directory through an exclusive, synced temporary file and an atomic no-clobber publish. Publication and cleanup share one local operation lock. Before claiming a job, the worker reserves that lock and keeps the same validated reservation through provider execution and local publication, so an overlapping scheduled cleanup skips before it can strand a completed provider result. An apparently stale lock is removed only after its bounded record validates and its owner PID is certainly dead; a live or uncertain owner remains busy. Cleanup recognizes the exact two-link temp/final state left by a crash between atomic publication and temp-name removal, validates its filename/hash/inode relationship, removes only the temp name, and rechecks the final single-link artifact before retention processing. A nonidentical pre-plant or unsafe collision fails closed; byte-identical content is intentionally accepted as an idempotent replay. These are integrity checks, not cryptographic authorship: processes running as the same Windows user and administrators remain inside the trust boundary. The bridge acknowledgement contains no transcript, prompt, summary, recommendation, contact detail, or other generated content. `npm run test:anam:hermes-runtime` is the opt-in live proof: with `AMY_ANAM_HERMES_RUNTIME_INTEGRATION=1`, the isolated home, and the Python command set locally, it verifies that the prompt is absent from process arguments and every isolated-profile file, while `state.db` keeps the same hash, size, and modification time.

Run `npm run hermes:amy-anam-cleanup` independently of the worker to unlink expired final files and stale temporary files. The command loads no Anam, Redis, Hermes, AgentMail, or email secret; it returns only a content-free count summary, does not create a missing output directory, and reports linked, future-dated, changed, or locked artifacts instead of following them. If a writer owns the shared lock, independent cleanup skips without touching artifacts and exits with code `3`, so the scheduler retries on its next run. The per-user Windows Scheduled Task `AI Fusion Labs - Amy Anam Hermes Cleanup` is enabled hourly on this test machine; its most recent observed run on 2026-07-15 returned `0`. A powered-off machine or disabled scheduler prevents a strict wall-clock guarantee; this is namespace deletion, not forensic secure erasure.

`GET /api/anam/amy/readiness` is a content-free, bearer-authenticated readiness view that reuses the worker secret. It reports the effective session, recovery, Hermes, memory, and promotion gates without exposing secret or memory content. `POST /api/anam/hermes/worker` uses the same bearer authentication, accepts a maximum 32 KiB JSON body, and supports only `claim`, `begin`, `ack`, and `fail` operations. Claims require the exact `amy_anam_hermes_worker_v2` protocol value before any lease is created. Stop the worker during a server/worker update, deploy the server, then restart the matching worker; mixed versions fail before claim rather than bypassing `begin`.

## Phase 3 local human-review boundary

Run `npm run hermes:amy-anam-review -- --latest` to read the newest local Hermes result, or add `--all` to read every result still inside the viewer-enforced 24-hour temp window.

This is intentionally a local, read-only terminal viewer. It accepts only the strict filename pattern plus a self-consistent content hash and output schema; that validates integrity but does not authenticate a job ID's provenance against Redis. It rejects linked artifact files, hard links, changed files, future-dated files, expired files, and resolved paths outside the operating-system temp directory, and removes terminal control sequences. The same-user/administrator boundary still applies, and the viewer's root-directory checks are not a claim that every possible linked parent component is cryptographically authenticated. Identifiers, contact details, URLs, secrets, and local paths found inside generated text are redacted by the same sanitizer used before provider input. It does not load secrets, call the network, spawn a process, write a review ledger, or expose approve/apply/send/store controls.

The viewer itself remains read-only; the banner `ANALYSIS ONLY - NO AUTHORITY` makes that boundary visible. A person can inspect the summary, recommendations, risk flags, and zero-action safety proof. Saving a memory requires a second, explicit local command and a separate operator secret as described below. Viewing a result alone never authorizes memory, tools, AgentMail, email, or any outbound action.

## Phase 6 consented returning-user memory

The Cara 4 test page now has an Amy-specific check-in. The visitor supplies a display name, an email-shaped test identity, the shared test access code, and explicit memory consent. This is suitable only for designated testers: the shared code controls access, but the app does not verify that the visitor owns the supplied email address.

After normalization, the email is immediately converted to a salted Amy-specific SHA-256 identity. The raw email is not stored in the browser identity, session link, approved history, readiness response, or promotion response. Each visit still creates a new Anam session. The server links that session to the pseudonymous identity so the same consenting test identity can retrieve up to eight approved notes across visits; a different identity receives a separate history. Approved history expires after 365 days, the short browser check-in expires after four hours, and the session-to-identity link expires after 30 days. The check-in page provides `Forget approved notes` and `Exit` controls.

At session start, approved notes are added with the Anam JavaScript SDK's live context method after both connection and session readiness. The context labels notes as reference data rather than instructions, omits identities and storage details, and tells Amy not to pretend to remember when no approved note exists. This preserves the existing server-owned Cara 4 persona, tools, and knowledge configuration.

Hermes never writes memory automatically. First inspect the newest candidate with `npm run hermes:amy-anam-review -- --latest`. To make a deliberate decision, configure the local process with `AMY_ANAM_MEMORY_PROMOTION_URL=https://<preview>/api/anam/amy/memory/promote` and the same branch-scoped `AMY_ANAM_MEMORY_OPERATOR_SECRET`, then run exactly one of:

- `npm run hermes:amy-anam-memory-decision -- --approve`
- `npm run hermes:amy-anam-memory-decision -- --reject --reason=operator_rejected`

The server accepts the decision only when the job exists as a completed, content-free Hermes receipt and the reviewed local output hash matches that receipt exactly. Approval stores only the sanitized summary, inquiry type, and up to five next steps. Decisions are idempotent and immutable: a rejected job cannot later be approved, and an approved job cannot be duplicated into history.

## Phase 4 deterministic review triage

The local viewer now shows `Suggested review priority (rule-based, no authority)`. The value is computed in memory from fixed booleans after the existing filename, hash, retention, and output-schema checks:

- `HIGH`: Hermes explicitly requested human review, or the validated output flagged privacy, unsupported-claim, or pricing/inventory risk.
- `MEDIUM`: no high-priority reason exists, but a technical-term or repeated-question risk is present.
- `LOW`: none of those flags is present.

Reason codes use a fixed enum and fixed order. Summary and recommendation strings are not read by the triage rule. Priority is derived solely from model-produced boolean flags and remains a non-authoritative suggestion. The derived result is never written to the local packet, acknowledged to the worker bridge, stored in Redis, returned by the session status route, or used to trigger an action. `HIGH` means review first; `LOW` does not mean approved, correct, or safe.

## Phase 5 provider-input and local-artifact hardening

Before Hermes sees a transcript, every source turn is shape- and size-validated. Included turns are then sanitized incrementally: text is NFKC-normalized, lone surrogates are replaced deterministically, terminal/control/bidi/zero-width characters are removed or flattened, and contact details, URLs, sensitive paths, identifiers, hashes, JWT/Bearer values, labeled secrets, prefixed tokens, and international phone numbers are replaced in memory. The result is canonical JSON with fixed `visitor` or `amy` speakers. Only complete turns are included under both the 48,000-character and 72 KiB UTF-8 envelope limits; later turns are not expensively sanitized after the next whole turn cannot fit. The worker also measures the exact serialized runtime input against Python's 128 KiB stdin limit. The prompt builder parses the envelope again and rejects legacy text, malformed JSON, extra keys, noncanonical serialization, or any text that is not already in its sanitized form.

This prevents structural role-line smuggling and closes the known secret/path leakage cases. It does not make transcript language semantically trustworthy; the no-tool runtime, exact output contract, one-request provider guard, and zero-action receipt remain the authority boundary.

The richer legacy intelligence fields such as top questions, pain points, and objections remain deferred. The input, provider, writer, cleanup, and approved-memory boundaries are hardened, and hourly Windows cleanup is registered on this test machine. The richer provider-output schema has not been designed or approved; do not bypass that boundary by adding fields to the existing v1 output.

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
11. Confirm `/api/anam/amy/readiness` reports Hermes and memory gates accurately while tools, AgentMail, and outbound actions remain effectively closed.
12. Confirm an unauthenticated Hermes worker request returns `401`; then run `npm run hermes:amy-anam-shadow -- --once` with the isolated profile and verify a content-free `completed` or explicit retry result.
13. Run `npm run hermes:amy-anam-review -- --latest` and confirm it shows the local `ANALYSIS ONLY - NO AUTHORITY` packet without identifiers or any action control.
14. Confirm the viewer shows the deterministic priority and fixed reason codes; generated summary/recommendation text must not affect that result.
15. Confirm `/api/anam/session/status` reports `contentIncluded:false`, zero tools/emails/outbound actions, and no generated summary, priority, or transcript fields.
16. Verify a synthetic ended, zero-message transcript remains pending before 30 minutes and becomes `transcript_unavailable` only at the grace boundary.
17. Run `npm run hermes:amy-anam-cleanup` against synthetic fresh, expired, and interrupted temp/final hard-link pairs. Confirm crash recovery leaves one valid final link, expired artifacts are unlinked, a live writer returns content-free `busy:true` with exit code `3`, and the worker does not claim while busy.
18. Confirm a claim without the exact v2 protocol fails before leasing, `begin` creates the execution marker and 10-minute grace before provider spawn, an already-started/stale/lost begin response never spawns a second provider process, and ACK without the matching marker is stale.
19. With the deterministic runtime self-test and opt-in live runtime proof, confirm the exact endpoint/one-request evidence, no OAuth refresh, no redirects/proxy trust, TLS verification, and zero SDK retries.
20. Check in as test user A with consent, complete a session, review the Hermes candidate, approve it with the separate decision command, then start a new Anam session as user A and confirm Amy receives the approved context. Confirm test user B cannot see it, no-consent user C creates no session identity, forgetting A removes the history, and wrong access/operator codes fail closed.
21. Do not change the production Amy persona mapping until the comparison passes and both the recovery schedule and local cleanup schedule are configured and observed.

## Fleet sequence after Amy

Once Amy passes, repeat the same process one agent at a time: snapshot, duplicate, stable Cara 4 canary, preview comparison, promote or roll back. Do not mass-change all persona IDs at once.
