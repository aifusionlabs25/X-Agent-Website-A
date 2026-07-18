# Anam X Agent fleet status — 2026-07-14

This is a read-only live Anam API inventory of the ten persona IDs currently registered in `lib/agents.ts`. Amy's separate canary is the only new persona created during this work.

| Agent | Registered persona health | Current model | Stable Cara 4 available on current avatar | Tools | Action |
| --- | --- | --- | --- | ---: | --- |
| Dani | Healthy | Cara 3 | Yes | 1 | Eligible after Amy; also passed an SDK 4.20 QA streaming control. |
| Taylor | **Missing — Anam returns 404** | Unknown | Unknown | — | Repair the stale persona mapping before any Cara migration. Do not treat this as an SDK failure. |
| Michael | Healthy | Cara 3 | Yes | 1 | Eligible after Amy. |
| Sarah | Healthy | Cara 3 | Yes | 1 | Eligible after Amy. |
| James | Healthy | Cara 3 | Yes | 1 | Eligible after Amy. |
| Morgan | Healthy | Cara 3 | Yes | 0 | Eligible after Amy; verify whether zero tools is intentional. |
| Luke | Healthy | Cara 3 | Yes | 0 | Eligible after Amy; verify whether zero tools is intentional. |
| Claire | Healthy | Cara 3 | Yes | 1 | Eligible after Amy. |
| Amy | Healthy | Cara 3 | Yes | 3 | Stable Cara 4 canary created and verified; public mapping unchanged. |
| Evan | Healthy | Cara 3 | **No — avatar reports Cara 3 only** | 1 | Requires an avatar upgrade or replacement before a Cara 4 canary. |

## What this means

- Eight registered personas are healthy and their current avatar assets already support stable Cara 4: Dani, Michael, Sarah, James, Morgan, Luke, Claire, and Amy.
- Taylor is a separate production-health issue: the website currently points to a persona ID that no longer exists in Anam.
- Evan cannot be moved by changing a model field. His current avatar must first gain a Cara 4 version or be replaced with a Cara 4-compatible avatar.
- The fleet uses several different LLMs and different tool counts. Model migration must preserve each agent's own LLM, prompt, voice, greeting, tools, and knowledge rather than copying Amy's configuration across the fleet.

## Recommended sequence

1. Finish Amy's preview comparison and either promote or roll back Amy.
2. Repair Taylor's stale persona mapping as a focused health fix.
3. Move one healthy, Cara 4-compatible agent at a time using the same snapshot → duplicate → preview → compare → promote/rollback workflow.
4. Check Morgan's and Luke's zero-tool configurations before migration.
5. Handle Evan in a separate avatar-upgrade lane.

Suggested first post-Amy control: Dani, because Dani already streamed successfully with SDK 4.20.0 during this audit. Keep each old persona ID for immediate rollback.

## Amy verification evidence

- Public Cara 3 Amy streamed at `720×480` on SDK 4.20.0.
- Canary stable Cara 4 Amy streamed at `1152×768` on SDK 4.20.0.
- The canary preserved Amy's source avatar, voice, GPT OSS 120B LLM, and all three tool/knowledge attachments.
- QA text conversation, interruption, reconnect, and video rendering worked locally.
- The QA route made no `/api/save-transcript` request.
- A direct canary transcript safety check returned `outbound: false` and created no transcript file.
- Anam emitted a warning that leaked internal reasoning text was recovered and suppressed during the canary conversation. No reasoning text reached Amy's speech or visible transcript. Treat this as a canary observation to recheck, not as a production promotion blocker by itself.
