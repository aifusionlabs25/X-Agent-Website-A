# Evan: automatic move-map presentation

## Customer experience

The Live Move Planner opens to Route when Evan finishes his first uninterrupted pickup/destination question, such as "Where are you moving from and to?" The existing desktop layout keeps Evan on the left and the planner on the right. Mobile retains the existing full-panel presentation and close control.

Before locations are known, the map shows a clearly labeled, unmarked Phoenix-area overview. It does not request GPS access or invent customer locations. Existing conversation-derived city pins and visitor-confirmed street-address updates continue to work. The route line indicates stop order, not driving directions.

## Boundaries

- Browser-only presentation; no new model/tool round trip, speech, email, geocoding request, or provider configuration change.
- Enabled only for the configured Evan persona and existing Move Planner feature flag. Amy and Dani do not create this controller.
- One automatic opening per session. Manual or explicit tool opening also consumes the automatic opportunity, so a later question does not switch an already chosen tab.
- Closing the planner with X or Escape prevents automatic reopening. Manual and explicitly requested tool reopening remain available.
- The detector assembles bounded SDK chunks by message ID and accepts only complete, uninterrupted `persona` messages. User messages, incomplete/interrupted questions, duplicate final events, and closed sessions do not open it.
- No prompt, KB, persona ID, voice setting, or email configuration changed. Street addresses still require the existing confirmation process.

## Verification

- Evan release suite: 134 passing checks, including 26 new trigger, lifecycle, integration, and empty-map checks.
- Existing regression suite: 552 passed, one skipped.
- Optimized Next.js build, TypeScript check, and targeted helper/map-component lint passed.
- The shared player's previously reported baseline lint issue was not changed.
- Real-browser simulation with the actual shared player, planner, and Leaflet map passed nine checks: greeting stays closed, the question opens Route, city answers create pins, dismissal is respected, manual/tool reopening works, full-screen/Escape works, and Amy remains isolated. SDK/token responses were mocked; no live Anam conversation, microphone access, geocoding, or email send occurred.

Reproduce the isolated UI check with `node scripts/anam/test-evan-planner-ui.mjs` (requires installed Playwright). Generated evidence stays in ignored `work/evan-6097-promotion/planner-ui/`. This simulation verifies the browser behavior, not future model phrasing or live voice quality.

Deploy only to the existing candidate test environment. Production promotion is separate and follows a successful live retest.
