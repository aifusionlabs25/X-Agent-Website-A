# Evan live planner and closing reliability checkpoint

Date: 2026-10-17
Branch: `codex/evan-6097-promotion`
Candidate persona: `6097c73e-b6ef-48c5-94c7-9a95d4863b99`

## Observed failure

The latest reviewed visitor session (`65b2cbb2-76f1-4b95-b24d-3d2f6df0c6ce`) had no planner tool call. Its uncertain Mesa/Gilbert discussion did not satisfy the earlier automatic-opening rules. The provider transcript also repeated a phone readback in one persona turn. Seven end-session requests were refused, including after natural closing phrases the browser did not recognize. The visitor ultimately exited manually.

These are separate failures. A successful page load or token request does not prove the planner, live updates, model conversation, or actual close lifecycle works.

## Changes

- Open the planner once when useful grounded stop details arrive, including a possible stop; keep uncertain locations separate from confirmed map pins. Respect manual dismissal.
- Process genuine transcript message boundaries when a final marker is missing. Handle cumulative visitor corrections and duplicate final events without duplicating or losing details. Do not interpret a message boundary as completed farewell audio.
- Preserve declined packing, flexible timing, stairs, and phone-only morning callback preferences in the live brief.
- Recognize contextual “Nope, we're good there” and explicit “Closing now.” New visitor speech still cancels a pending hang-up. Stale transcript completion cannot restore old close consent.
- Tell the candidate to read a phone number once, wait for confirmation, and treat a refused end-session request as a refusal rather than a failed tool to retry.
- Add a bounded Evan-only recovery for an unauthorized farewell after refusal, or 12 seconds of silence when no response was provided. It can intervene only once per session and cancels on new visitor speech, approved closing, or teardown. A question already asked does not trigger another question. Attempted bad provider output remains test evidence, not a claim of model compliance.
- Keep the existing Amy stream path and provider configuration unchanged.

Managed prompt SHA-256: `94eb7d7d086edea4e5167280c60c9adefe6243dade1a8d90d0768a84e0a66ef7`.
The candidate-only prompt update used an idle-session check, backup, read-back verification, and preservation of all non-prompt configuration.

## Evidence and limits

The real React/player/planner browser replay uses simulated SDK transport and synthetic contacts. The separate bounded Anam check uses real SDK 4.20.0 with typed visitor messages and muted video, not microphone/ASR. Neither check sends emails.

Real test `2cbd7c0a-c755-4192-8d13-3fcc5be0edc0` confirmed one phone readback but exposed a premature spoken farewell after the close tool was refused. Follow-up test `9cc026d7-e3d9-415d-8ccc-05f68a0acca1` exposed silence after refusal instead. These were not counted as passes; they motivated the recovery and clearer refusal receipt.

Human voice testing is still required. This candidate must not be promoted to production merely because deterministic tests pass.

## Release boundary

Publish only to the protected custom test environment with `ANAM_RECOVERY_NAMESPACE=evan-6097-candidate` and without assigning domains. Do not merge main, change Amy/Dani personas, or promote the public website.

The earlier production baseline was `dpl_3AmVsSi9cbASHK7ZTiufPy24gmho`. A subsequent read-only check during this work found production had independently advanced to `dpl_532oXZx47MLz9UWBmRWkzDx4dqLF`, main commit `eb3ce310a94acff6a98f9929f08f4a0c41f927c6` (“Require invitation check-in for every Amy session (#62)”). This task did not make that change and must not replace it with the older candidate branch.

## Final local verification

- 328 Evan release tests passed.
- Full shared suite: 559 passed, one existing skip.
- Browser replay passed all checkpoints, including automatic route opening, live corrections, contact updates, missed-final recovery, safe natural closing, and no repeated question during a legitimate listening pause.
- Next.js 16.4.1 production build passed (45 routes); scoped lint and whitespace checks passed.
- Real SDK run `544f34a6-430b-4173-9c32-e682a85befad` completed seven checkpoints with no targeted flags.
- After the final prompt clarification, run `140dc82a-6b37-4b2a-a956-0750f63e14f3` completed seven checkpoints: one phone readback, no repeated question, one farewell, and automatic stop after farewell. The provider attempted one premature end-tool call; the browser refused it, and Evan continued correctly. This remains a model-compliance warning, not an unqualified pass. No forced recovery was needed in that call.

Deployment results follow after protected-preview verification.
