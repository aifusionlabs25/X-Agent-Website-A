# Evan Live Move Planner: correction reliability

## Problem and fix

Live transcript events reached the browser, but previously confirmed street stops permanently overrode later conversation-derived route edits. Timing/property extraction preferred the first historical match, and item/service/access extraction accumulated positive words without applying cancellations. Leaflet also rebuilt for unrelated transcript updates.

The candidate now applies supported visitor edits chronologically:

- Change origin/destination, add/remove additional stops, and reorder them.
- Recognize short location answers using Evan's immediately preceding location question.
- Replace timing/property facts and remove or re-add services, specialty items, and access factors.
- Apply edits to a street-address route without discarding unchanged verified pins.
- Immediately revoke an old street pin when its address changes. Show a city-level/unresolved working location until the new full address is confirmed and geocoded; never infer exact coordinates.
- Fence and cancel older lookups when newer details supersede them. Abandoned pending lookups become unresolved, rather than staying pending forever.
- Preserve map zoom/tiles during unrelated conversation. Actual location, address, coordinate, precision, order, and removal changes still redraw.
- Keep updates while the planner is closed and in full-screen mode, without undoing the user's close choice.

Tool receipts now describe the current visible model, including city-only routes. Partially invalid confirmed-address lists fail closed rather than silently replacing the route with an incomplete subset.

## Scope and safeguards

Evan candidate only: `6097c73e-b6ef-48c5-94c7-9a95d4863b99`, branch `codex/evan-6097-promotion`. No Anam persona, system prompt, KB, voice setting, credentials, public production alias, or Amy behavior changed. Amy keeps its original transcript-update branch.

No new model calls, browser speech, external services, persistence, or automatic address geocoding were added. The existing confirmed-address tool remains required for precise street pins. The connecting line shows stop order, not driving directions or operational approval.

City recognition remains limited to the existing supported-city dictionary. The local parser handles explicit supported edits, not arbitrary natural language; ambiguous same-city removals and hypothetical alternatives do not invent or silently delete locations. Full street addresses still require confirmation.

## Verification

- `npm run test:evan:release`: 180 passed, including 46 new correction, reconciliation, and map-lifecycle tests.
- `npm test`: passed (one existing skipped test). Initial sandbox run hit OS temp-directory permission checks; the authorized unsandboxed run passed.
- TypeScript, targeted ESLint, and optimized Next.js build passed.
- Browser harness: 20/20 passed using the actual shared React player, planner, and Leaflet with mocked SDK/token/geocoder responses, including delayed requests and same-city street corrections. Zero browser errors or unexpected requests. No live Anam conversation or outgoing email is part of this simulation.

## Suggested live retest

1. Start with Gilbert to Queen Creek. The route should open automatically after Evan's location question.
2. Change the destination to Scottsdale; Queen Creek must disappear from pins and directions.
3. Add storage in Mesa and a stop in Chandler; put Chandler before Mesa, then remove Mesa.
4. Change next week to next month, change the home size, and remove/re-add a piano or packing request.
5. Confirm street addresses, then correct one during the same call. Its old street pin must disappear while the new address is confirmed; the unchanged street pin should remain.
6. Repeat a change with the map expanded, then with the planner closed; reopening should show the latest state.

Deploy to the existing candidate test environment only. Public production promotion remains a separate decision after the live retest.
