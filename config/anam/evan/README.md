# Evan Anam configuration

This directory is the managed source for the Evan Mullins Moving replacement candidate. The public website remains on the previous persona until the candidate passes a live browser conversation and is deliberately promoted.

## Identity safety

- Replacement candidate: `6097c73e-b6ef-48c5-94c7-9a95d4863b99`
- Previous public Evan (protected during candidate testing): `4b7e933a-ea04-4b84-b418-72c0762545e6`
- Protected James persona (never use for Evan): `8a991c93-0c95-42c5-8c22-a67428946eb8`

The identity of all three IDs is checked before any sync.

## Contents

- `EVAN_ANAM_SYSTEM_PROMPT_2026-07-16.md`: managed spoken-conversation prompt.
- `knowledge/`: the eight customer-facing, fact-only documents approved for Anam retrieval.
- `knowledge-manifest.json`: folder name, source policy, document allowlist, and exclusions.
- `persona-manifest.json`: expected persona identity, model, greeting, and tools.

Evan's managed voice detection waits through natural pauses: sensitivity `0.05`, a `3` second mid-sentence pause tolerance, disabled silence prompts and silence-based session ending, and speech enhancement `0.7`.

Internal strategy, Tavus/PAL runtime instructions, test-specific answers, draft workflows, transcripts, questionnaires, and backups are intentionally excluded from the live KB.

## Commands

```powershell
npm test
npm run anam:audit:evan
npm run anam:smoke:evan-websocket
node scripts/anam/update-evan-persona.mjs
node scripts/anam/update-evan-persona.mjs --apply --confirm-6097-replacement
```

The update command defaults to a read-only dry run. Applying requires the explicit replacement confirmation flag. It updates only the pinned `6097…` persona and its pinned tools, uploads only missing allowlisted documents, waits for every document to become `READY`, then performs immediate and delayed read-back verification. A local ignored rollback receipt is saved before mutation; the updater does not create extra Anam personas or tools.

## 2026-10-17 replacement-candidate result

- Candidate name: `Evan Mullins Moving Concierge - Replacement Candidate`
- Managed prompt SHA-256: `870f9f5e43caf1cf911a67d77b5687757388978e7e4882db4ff9399e84792834`
- Knowledge bundle SHA-256: `9554e57575dc25b84b23212cd223b06b7ab8b0fc49c7d490fe093cb80b830035`
- Knowledge folder: `c9ad40d1-05ba-4cd6-84b4-f9fa90b1a112`
- Knowledge tool: `fc93e067-9254-4635-a4a6-645970d12548`
- Eight of eight documents reported `READY`; delayed read-back passed.
- Session token, engine start, and secure WebSocket smoke test passed.
- The exact tool, avatar, voice, model, prompt, voice detection, transcript, and retention settings are fail-closed in the website readiness check.

## 2026-07-16 live result

- Live prompt SHA-256: `ff5aec4793995d26d1d3e405055c042511a661dccd6652105935049603a5004b`
- Knowledge bundle SHA-256: `d378ba746bf63af2ec4fa7511c45b8b8abd2a5a7834b192892821e15051753c0`
- Knowledge folder: `e2967de5-94d6-4134-b35d-16f5c7453434`
- Knowledge tool: `ad2e09f5-1360-4f4e-b692-8aaaa55cc976`
- Historical rollback persona: deleted from Anam after validation to conserve persona capacity.
- Required live tools: `Knowledge_Evan_Mullins_Moving`, `skip_turn`, `end_mullins_session`, `send_mullins_follow_up_email`, `show_move_planner`
- `end_mullins_session` arms a one-farewell close handshake after unmistakable closing intent. The browser waits for Evan's brief goodbye before closing and never asks for a second confirmation.
- Evan's required secure check-in captures scoped follow-up authorization. The backend pre-queues the transcript-first three-message bundle when the verified session binds; it does not depend on the model remembering an email tool call.
- Eight of eight documents reported `READY`; delayed read-back passed.

## 2026-07-19 responsiveness update

- Reduced end-of-speech sensitivity from `0.3` to `0.05`.
- Increased mid-sentence pause tolerance from `1.3` to `3` seconds.
- Disabled silence prompts and silence-based session ending.
- Set speech enhancement to `0.7` to reduce false turn endings from background noise.
