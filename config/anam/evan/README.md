# Evan Anam configuration

This directory is the managed source for the live Evan Mullins Moving Anam persona.

## Identity safety

- Evan: `4b7e933a-ea04-4b84-b418-72c0762545e6`
- Protected James persona (never use for Evan): `8a991c93-0c95-42c5-8c22-a67428946eb8`

The live identity of both IDs is checked before any sync.

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
node scripts/anam/update-evan-persona.mjs
node scripts/anam/update-evan-persona.mjs --apply
```

The update command defaults to a read-only dry run. `--apply` creates or reuses a dated rollback persona, uploads only missing allowlisted documents, waits for every document to become `READY`, updates the knowledge tool and persona, then performs immediate and delayed read-back verification.

## 2026-07-16 live result

- Live prompt SHA-256: `ff5aec4793995d26d1d3e405055c042511a661dccd6652105935049603a5004b`
- Knowledge bundle SHA-256: `d378ba746bf63af2ec4fa7511c45b8b8abd2a5a7834b192892821e15051753c0`
- Knowledge folder: `e2967de5-94d6-4134-b35d-16f5c7453434`
- Knowledge tool: `ad2e09f5-1360-4f4e-b692-8aaaa55cc976`
- Rollback persona: `8fe1fcdd-172d-4974-afcf-b3608c8181a3`
- Required live tools: `Knowledge_Evan_Mullins_Moving`, `skip_turn`, `end_call`
- Eight of eight documents reported `READY`; delayed read-back passed.

## 2026-07-19 responsiveness update

- Reduced end-of-speech sensitivity from `0.3` to `0.05`.
- Increased mid-sentence pause tolerance from `1.3` to `3` seconds.
- Disabled silence prompts and silence-based session ending.
- Set speech enhancement to `0.7` to reduce false turn endings from background noise.
