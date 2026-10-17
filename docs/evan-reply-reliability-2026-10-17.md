# Evan candidate reply reliability — 2026-10-17

## Scope

Candidate persona: `6097c73e-b6ef-48c5-94c7-9a95d4863b99`.
This update does not promote the candidate to the public production website, create another avatar, change the older production Evan persona, or change Amy/Dani prompts.

## Confirmed incident

Provider analytics showed a complete contact-information answer followed by a successful `skip_turn` system-tool call. There was no subsequent text, text-to-speech, or audio response. The website completion path worked. No email or map tool was involved in this incident. The logs establish the mistaken skip, not the model's internal reasoning.

## Changes

- Require a relevant response to completed answers, contact details, corrections, and callback preferences. Treat short answers to a confirmation as answers. Clarify uncertain consequential details instead of silently guessing or skipping the turn.
- Keep the existing patient speech-detection settings unchanged.
- Add one bounded recovery acknowledgment per session after an unexpected skip and 12 seconds of silence. Cancel for new speech, an agent response, useful tool work, closure, or unmount; do not interrupt or fabricate a user message. This is not a general silence auto-prompt.
- Bound Evan email/planner operations to eight seconds, including session binding and rendering waits. Abort requests, ignore stale results, and never automatically retry email or claim unknown delivery outcomes.
- Propagate map-request cancellation through provider calls and between stops. Slow/failed lookups remain unconfirmed rather than holding the conversation indefinitely.
- Prevent late tool receipts from restarting a closing conversation or speaking over a newer planner result.
- Restrict Amy-specific closing and email context injections to Amy.
- Show a useful microphone-permission error for Evan and record content-free browser tool lifecycle diagnostics.
- Add a candidate-pinned prompt-only updater. It checks for active sessions, saves a local ignored backup before mutation, changes only `systemPrompt`, and verifies the prompt plus unchanged persona configuration afterward.

## Verification

The existing regression suite passed (552 passed, one skipped). New targeted tests cover the prompt contract, recovery event ordering, deadlines, late results, cancellation, code integration, and safe provider updating. The optimized Next.js build and TypeScript check passed. Windows sandbox restrictions required running the full filesystem tests and build outside the sandbox.

Automated tests do not establish that the model will always choose correctly. A fresh live voice retest is required before production promotion: give contact information, confirm with a short yes, ask for a map update, explicitly ask Evan to wait, then resume and end naturally. Check that the farewell is not interrupted by a late tool response. Multi-address map lookups may show an unconfirmed result when their provider is too slow.

Prompt SHA-256: `870f9f5e43caf1cf911a67d77b5687757388978e7e4882db4ff9399e84792834`.

Old candidate deployment URLs pin the old prompt hash and should not be used after publication. Use the new verified candidate URL supplied with this release. Production remains unchanged pending a successful live retest.
