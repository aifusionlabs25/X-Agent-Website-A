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

The existing `ANAM_API_KEY` and branch-scoped `ANAM_AMY_CARA4_PERSONA_ID` are also required. Never use a `NEXT_PUBLIC_` prefix for any value above.

Gate behavior:

- `ENABLED` absent or not `true`: the experimental spine is off and existing agents retain their old behavior.
- `ENABLED=true` with a missing secret, Redis value, or explicit `KILL_SWITCH=false`: Amy Cara 4 returns `503`; it does not silently start an untracked canary session.
- `ENABLED=true`, `KILL_SWITCH=false`, and all server values present: the token response must include `sessionSpineEnabled:true` and a UUID `launchId`.

The completion endpoint persists `verification_pending` before it calls Anam, so closing the page cannot erase completion intake. Next.js `after()` is the preview fast path. A Redis due-set retains delayed work, but an independent scheduled drain is still required before production promotion so a deploy or platform timeout cannot strand a late transcript.

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
10. Do not change the production Amy persona mapping until the comparison passes and an independent finalization drain exists.

## Fleet sequence after Amy

Once Amy passes, repeat the same process one agent at a time: snapshot, duplicate, stable Cara 4 canary, preview comparison, promote or roll back. Do not mass-change all persona IDs at once.
