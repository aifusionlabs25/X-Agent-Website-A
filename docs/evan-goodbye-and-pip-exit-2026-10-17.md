# Evan candidate: natural goodbye and planner Exit

Date: 2026-10-17
Scope: candidate persona `6097c73e-b6ef-48c5-94c7-9a95d4863b99` on the isolated Evan test deployment. No production promotion or Anam persona, system-prompt, or knowledge-base writes.

## Findings

The latest reviewed session contained an explicit visitor goodbye and Evan's correct farewell. Visitor speech resumed roughly two seconds after the farewell audio, inside the previous 2.5-second closing grace period. This is consistent with the visitor-speech cancellation guard restarting the conversation; the provider transcript alone cannot prove the browser callback sequence.

A separate edge case could delay closure when Anam continued the farewell under the same message ID as the pre-tool response. The old message-ID exclusion would then wait for the fallback timer.

## Changes

- After an authorized goodbye and completed farewell, use a one-second playback margin instead of 2.5 seconds.
- Accept only new, post-arm farewell text when the provider reuses a message ID. Old text, empty repeated markers, questions, and partial speech do not complete the farewell.
- Recognize natural whole-statement wrap-ups such as "I'm set for now" and "That's everything." Preserve negation, scoped-detail, continuation, question, and interrupted-speech safeguards.
- Put an accessible Exit button below Evan while the desktop planner is open. On mobile, keep Exit available in the planner footer.
- Both buttons use the existing session exit/cleanup path. Closing the planner is no longer necessary to leave the session.
- Amy and Dani behavior is unchanged; the new close logic and controls are Evan-scoped.

## Verification

- Evan release suite: 227 passed.
- Existing project regression suites: 557 passed, one existing platform skip.
- Browser harness: 33 checkpoints passed, including reused-message-ID farewell, resumed-speech cancellation, desktop/mobile Exit, live planner updates, and Amy isolation.
- Production build and TypeScript passed.
- Changed-file lint passed with the existing unrelated `react-hooks/set-state-in-effect` finding excluded for that invocation; no lint configuration was changed.
- Visually reviewed desktop and mobile screenshots. Browser tests use a mocked Anam transport and do not create live calls or send email.

## Live acceptance check

On the fresh candidate link, finish with a clear wrap-up, let Evan complete his goodbye, and confirm that the call ends automatically. Also confirm that Exit works while the planner remains open. Live audio remains a user acceptance check; the automated harness does not reproduce provider streaming latency.
