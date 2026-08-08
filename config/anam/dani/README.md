# Dani Anam Prompt Stability Runbook

This workflow repairs only Dani's managed system-prompt identity. It does not change the website registry, persona name, greeting, avatar, voice, LLM, language, tools, knowledge, retention, widget, or voice settings.

## Canonical target

- Persona ID: `61f0fd3e-7937-472a-958d-cdba76b33bf1`
- Exact provider name required by the guard: `Dani X Agent Director`
- Public role: `X Agent Director`
- Canonical identity clause: `You are Dani, the X Agent Director at AI Fusion Labs.`
- Canonical first-sentence clause: `In a new conversation, your first sentence must be exactly: Hi, I am Dani, the X Agent Director at AI Fusion Labs.`

The script refuses to infer or rewrite any other prompt wording. It requires exactly one copy of both known legacy clauses:

- `You are Danny, an X Agents Sales Technician at AI Fusion Labs.`
- `In a new conversation, your first sentence must be exactly: Hi, I am Danny from AI Fusion Labs.`

## Safety contract

`scripts/anam/stabilize-dani-prompt.mjs` is a read-only dry run unless `--apply-prompt-only` is present. Every invocation also requires an explicit absolute `--backup-dir` outside the Git worktree.

Before any possible write, the script:

1. reads the exact Dani persona;
2. verifies the exact ID and exact provider name;
3. reads every attached tool and attached knowledge-group document listing;
4. writes the complete provider responses to an access-restricted snapshot;
5. writes rollback instructions without printing the prompt;
6. fingerprints the managed prompt, non-prompt persona configuration, tools, and knowledge metadata;
7. stops if `initialMessage` contains `Danny` or `Sales Technician`;
8. derives the candidate through the two literal replacements above and refuses missing, duplicate, or additional legacy identity wording.

Anam may append a generated `# TOOLS` section to `brain.systemPrompt`. The full provider response is retained in the protected snapshot, but only the managed portion before the `\n# TOOLS\n` delimiter is hashed, changed, sent, or used for rollback. The generated suffix is never written back as authored prompt content.

Apply mode sends one sparse request:

- `PUT https://api.anam.ai/v1/personas/61f0fd3e-7937-472a-958d-cdba76b33bf1`
- JSON body keys: exactly `systemPrompt`

It then performs immediate and five-second delayed provider read-backs. Both must match the corrected managed-prompt hash and the original non-prompt, tool, and knowledge fingerprints. Provider timestamps and the signed `videoUrl` / `idleVideoUrl` fields inside avatar objects are excluded because they rotate on ordinary GET requests; durable avatar identity and model fields remain covered.

## Backup directory

Use a dedicated local directory outside every repository. Restrict its NTFS permissions to the operator before running because the snapshot contains the complete internal prompt. The script requests owner-only filesystem modes, but Windows ACLs remain the operator's responsibility.

Do not use `_SYSTEM_OF_RECORD`, a repository directory, a synced shared folder, or a ticket attachment. Do not commit any generated snapshot.

Each run creates a new timestamped child directory containing:

- `provider-snapshot.json` — complete original provider responses and fingerprints;
- `ROLLBACK_INSTRUCTIONS.md` — prompt-safe recovery procedure;
- `stability-plan.json` — redacted dry-run/apply plan;
- `apply-result.json` — written only after both apply read-backs pass.

## Dry run

Keep `ANAM_API_KEY` in the ignored local `.env.local` file; the package command loads it without echoing it. Then run:

```powershell
npm run anam:stability:dani -- --backup-dir "C:\ABSOLUTE\PRIVATE\ANAM_BACKUPS"
```

The dry run performs provider GET requests and local protected backup writes. It performs no provider PUT.

Review the redacted console result and `stability-plan.json`. Do not paste `provider-snapshot.json` into chat or logs.

## Prompt-only apply

An apply changes live Anam configuration and requires explicit external-mutation authorization. After reviewing a successful dry run, rerun with a new backup snapshot:

```powershell
npm run anam:stability:dani -- --backup-dir "C:\ABSOLUTE\PRIVATE\ANAM_BACKUPS" --apply-prompt-only
```

Stop if any guard or fingerprint comparison fails. Do not retry by adding persona fields to the PUT body.

## Rollback

The snapshot's `persona.brain.systemPrompt` contains the original provider response. For rollback, extract only its managed portion before `\n# TOOLS\n`; do not send the generated tools suffix.

After fresh external-mutation approval:

1. take another complete protected snapshot of the then-current persona;
2. send a sparse PUT whose only JSON key is `systemPrompt`, using the original managed prompt from the selected snapshot;
3. perform immediate and delayed GET verification;
4. require the restored managed-prompt hash and unchanged non-prompt, tool, and knowledge fingerprints.

Never place the prompt or API credential directly in a command line, console output, committed file, or support ticket.

## Local verification

The focused suite uses mocked Anam responses and never reaches the network:

```powershell
npm run test:anam:dani-stability
```
