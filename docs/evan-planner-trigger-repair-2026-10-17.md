# Evan planner automatic-opening repair — 2026-10-17

## Live-test finding

The latest candidate session used the natural lead-in “If you'd like to discuss a new move” before asking for the origin and destination. The original detector rejected that sentence opening. Replaying the exact uninterrupted question reproduced zero automatic openings; removing only the lead-in made it pass. The flashing planner button was an availability animation, not evidence that the trigger fired.

## Changes

- Recognize common conversational lead-ins, polite location requests, and direct origin/destination questions. Keep quoted examples, hypothetical questions, and unrelated contact, price, timing, or access questions excluded.
- Add a second opening path after a completed customer turn when the existing Move Planner has both an origin and a destination. This also handles volunteered routes and answers arriving before Evan's final speech marker.
- Both paths use the same once-per-session controller. Manual opening, dismissal, and session disposal prevent later automatic reopening. Explicit manual/tool controls remain available.
- Open the Route view with the existing split-screen layout and current plan. No new speech, model call, tool wait, geocoding, or address confirmation is introduced.
- Preserve the live-correction behavior from commit 2072e16.

## Scope and verification

- Evan candidate persona: `6097c73e-b6ef-48c5-94c7-9a95d4863b99`.
- No Anam prompt, knowledge, persona, voice, email, or Amy behavior changes.
- 194 Evan release tests pass, including the new natural-wording and route-fallback tests.
- Full `npm test`, TypeScript, targeted ESLint, and optimized Next.js build pass.
- 24 browser checks pass using the real shared player and planner with a mocked Anam transport. Checks include the failed live wording, volunteered/chunked route, early visitor answer, live corrections, map/fullscreen, dismissal, and Amy isolation.
- Independent code review found no blocking issues.
- Browser tests do not establish real provider/audio behavior. A fresh human conversation remains the final live verification.

## Deployment boundary

Publish only to the existing isolated Evan test environment (`amy-ceo-rehearsal`, recovery namespace `evan-6097-candidate`). Do not promote the main website. Production baseline at this checkpoint: `dpl_3AmVsSi9cbASHK7ZTiufPy24gmho`.

## Suggested live check

1. Start a fresh session using the new test deployment link.
2. Let Evan ask where the move starts/ends, or volunteer “I'm moving from Gilbert to Mesa.” The Route panel should open without clicking its button.
3. Change the destination to Chandler; the visible route should update.
4. Close the planner; later route changes should not reopen it automatically. The manual button can still reopen the updated plan.
