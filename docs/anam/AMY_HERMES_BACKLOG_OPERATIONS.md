# Amy Hermes backlog operations

Amy's Hermes worker is post-session, analysis-only, and intentionally has no automatic learning authority. Use this procedure when the worker has been stopped long enough that queued reviews no longer represent the current Amy release.

## Safety contract

- Inspection is the default and does not claim, lease, process, or delete a job.
- Responses contain counts, timestamps, and a snapshot digest only. They contain no session IDs, transcript text, summaries, contact data, or generated review content.
- Retirement requires the same cutoff used for inspection, the exact returned digest, `--apply`, and the literal confirmation token.
- A job with an active lease or execution marker is protected and skipped.
- Retired jobs receive the content-free failure code `operator_retired_stale` and move to the bounded dead-letter namespace. Their transcript is never read.
- A missing job record is treated as an orphan pointer. Only a pre-cutoff orphan whose exact sorted-set score is covered by the inspected digest may be removed; an active marker, changed score, or restored job record prevents removal.
- Do not run retirement while the Hermes worker is running.

## Content-free failure inspection

The authenticated worker bridge can report the most recent dead-letter receipt without exposing its job identity or session content. Load the private worker environment files and run:

```powershell
npm run hermes:amy-anam-backlog -- --latest-failure
```

The response is limited to `deadLetterCount`, `observedAt`, `status`, `failureCode`, `attempts`, `hermesExecutionHappened`, `outputContractValid`, and `contentIncluded: false`. It never includes a job ID, session ID, transcript, contact data, or generated review content. This command is read-only and cannot be combined with retirement arguments.

The continuously running worker also atomically replaces `<HERMES_HOME>/worker-result-latest.json` after each non-idle attempt. That local receipt is likewise content-free and is intended to prevent a one-line console result from being lost in a long-running task window.

## Isolated credential maintenance

OAuth renewal is never performed inside a customer review. Run the separate maintenance command from the isolated Amy worker environment:

```powershell
npm run hermes:amy-anam-auth-maintenance
```

Inspection is the default. It reports only the expiry window and whether refresh is due. The scheduled apply form is:

```powershell
npm run hermes:amy-anam-auth-maintenance -- --apply --confirm=CONFIRM_AMY_HERMES_AUTH_REFRESH
```

Apply requires `AMY_ANAM_HERMES_AUTH_MAINTENANCE_ENABLED=true`, `AMY_ANAM_HERMES_AUTH_MAINTENANCE_KILL_SWITCH=false`, the exact `openai-codex` / `gpt-5.5` identity, and an isolated absolute `HERMES_HOME`. It refreshes only inside the configured safety window, disables shared Codex credential recovery, creates a pre-refresh backup under `<HERMES_HOME>/auth-backups/`, and atomically writes `<HERMES_HOME>/auth-maintenance-latest.json`. Receipts never contain access tokens, refresh tokens, account IDs, session IDs, transcripts, or generated review content.

## 1. Choose and record the checkpoint cutoff

Use a UTC ISO timestamp immediately before the new worker baseline. Keep the exact string for both commands.

```powershell
$amyHermesCutoff = (Get-Date).ToUniversalTime().ToString('o')
$amyHermesCutoff
```

## 2. Inspect without mutation

Load the existing private worker environment files, then run:

```powershell
npm run hermes:amy-anam-backlog -- --cutoff=$amyHermesCutoff
```

Review `dueCount`, `queuedBeforeCutoff`, `retirableBeforeCutoff`, `protectedBeforeCutoff`, `missingJobCount`, `orphanBeforeCutoff`, `orphanAtOrAfterCutoff`, `oldestEnqueuedAt`, `newestEnqueuedAt`, and `snapshotDigest`. Stop if the scan is rejected, any post-cutoff orphan exists, or any protected job is unexpected.

## 3. Retire only after operator approval

Copy the exact digest from the inspection response. Retirement fails if the queue changed after inspection.

```powershell
npm run hermes:amy-anam-backlog -- --cutoff=$amyHermesCutoff --apply --expected-snapshot-digest=<SHA-256-FROM-STATUS> --confirm=CONFIRM_AMY_HERMES_STALE_RETIREMENT
```

The result reports only `attempted`, `retired`, `orphanPruned`, `protectedActive`, and `stale`. Rerun the inspection command and require `dueCount: 0`, `queuedBeforeCutoff: 0`, and `orphanBeforeCutoff: 0` before starting the worker.

## 4. Restart from the clean baseline

Back up the Windows Scheduled Task definition before changing its path or arguments. Start the worker only after the deployed server and local worker code use the same protocol version. Confirm the task remains running and verify the next newly completed Amy session produces one content-free completion receipt.

Do not use `--once` as a status command: it claims and may process a real job. Do not delete Redis keys manually.
