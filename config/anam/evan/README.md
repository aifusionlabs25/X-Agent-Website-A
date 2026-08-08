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
npm run anam:repair:evan-prompt -- --backup-dir C:\ABSOLUTE\PRIVATE\EVAN-BACKUPS
node scripts/anam/update-evan-persona.mjs
node scripts/anam/update-evan-persona.mjs --apply
```

The update command defaults to a read-only dry run. `--apply` updates only the existing Evan persona, uploads only missing allowlisted documents, waits for every document to become `READY`, updates the knowledge tool and persona, then performs immediate and delayed read-back verification. Git history is the rollback source; the updater does not create extra Anam personas.

## Emergency prompt-only repair

Use `anam:repair:evan-prompt` when Evan's live persona is otherwise correct but the managed prompt markers or prompt hash are out of sync. This is a separate, narrow control plane from the broad updater above. It never creates or updates tools, knowledge groups, or documents.

The backup directory is mandatory, must be an absolute path outside this Git worktree, and should be on an encrypted or access-restricted local volume. Every run first creates a timestamped subdirectory containing the complete provider persona, every attached tool object, referenced knowledge-group and document metadata, a repair plan, a prompt rollback artifact, and rollback instructions. Those files are intentionally sensitive: they contain the provider prompt and may contain private provider configuration. The command does not print prompt contents, tool contents, or the API key.

First perform the default dry run and inspect `repair-plan.json` without displaying the snapshot or rollback artifact in a shared terminal:

```powershell
npm run anam:repair:evan-prompt -- --backup-dir C:\ABSOLUTE\PRIVATE\EVAN-BACKUPS
```

The dry run makes only provider GET requests. It validates the exact Evan ID, the protected James ID, Evan/Mullins and James/Knowles names, Cara 4, all attached tool IDs, and referenced knowledge groups. If and only if that snapshot is reviewed, apply the canonical prompt with the exact confirmation phrase:

```powershell
npm run anam:repair:evan-prompt -- --backup-dir C:\ABSOLUTE\PRIVATE\EVAN-BACKUPS --apply CONFIRM_EVAN_PROMPT_ONLY
```

The apply path performs one sparse Evan persona PUT whose entire body is `{ "systemPrompt": "..." }`; it does not resend or update the name, greeting, voice settings, tool IDs, or any other provider field. Immediate and five-second delayed GETs must match the canonical managed-prompt hash and all four managed markers, while the stable non-prompt persona fingerprint must remain unchanged. Anam can append a generated `# TOOLS` section on read-back, so hashing and rollback intentionally use only the managed prompt before that delimiter. Provider timestamps and the signed `videoUrl` / `idleVideoUrl` fields inside avatar objects are excluded because they rotate on ordinary GET requests; durable avatar identity and model fields remain covered. Any mismatch fails the command and leaves the pre-repair snapshot and rollback artifact on disk.

To restore the exact prompt captured before an apply, use the absolute rollback artifact path from that run and a new backup directory. Rollback first snapshots the then-current live state, preserves its non-prompt settings, and changes only the prompt:

```powershell
npm run anam:repair:evan-prompt -- --backup-dir C:\ABSOLUTE\PRIVATE\EVAN-ROLLBACKS --rollback-artifact C:\ABSOLUTE\PRIVATE\EVAN-BACKUPS\evan-prompt-repair-TIMESTAMP\rollback-artifact.json --apply CONFIRM_EVAN_PROMPT_ROLLBACK
```

This mechanism cannot make a provider PUT atomic. If Anam accepts the PUT but a read-back check fails, stop using the broad updater, retain the generated artifacts, and use the reviewed rollback command. Restrict and eventually securely dispose of old backup artifacts according to the project's secret-handling policy.

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
