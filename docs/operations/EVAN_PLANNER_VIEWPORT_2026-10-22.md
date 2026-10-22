# Evan call-page planner layout — October 22, 2026

Status: implemented and locally verified in the separate public-demo release candidate. Not deployed. Stable checkpoint `ac9835d6456fd330b2e3faa7bf65987acab657d4` and production remain unchanged.

## UI-only changes

- Planner uses dynamic viewport height and the desktop width already reserved by the player (62vw, capped at 980px). No shared-player change was needed.
- Smaller header/section spacing; contact labels and values share rows. Body-value font size remains 13px.
- Detailed route-stop cards and the optional service catalogue use native keyboard-accessible expandable sections. No captured values are deleted or truncated.
- Next-step prompts use two columns where space permits; mobile tabs fit without hiding labels off-screen.
- The content area resets to the top when switching tabs, stays keyboard-scrollable for long records, and does not cover the footer. Mobile Exit and safe-area padding remain available.
- Capture, prompts, models, tool handling, session closure, email routing and backend files were not changed in this UI update.

## Verification

- 53 isolated browser checks passed; zero browser console errors or unexpected network requests. Real React/Leaflet rendering with a mocked Anam SDK; no real microphone, provider session, geocoding API or email send.
- Ordinary fixture: Move Brief, Move List and Next Steps require no vertical scrolling at 1366x768 and 1100x620. The short-window content height is 464px, matching its rendered scroll height on each tab.
- Route map and controls fit above the footer at 1872x830, 1366x768 and 1100x620. Expanded stop details remain accessible on demand.
- At 390x844, Move List and Next Steps fit; the longer stacked contact/brief view scrolls inside its bounded region (760px content in 621px), with Exit still visible. This is not a promise that arbitrarily long notes or every zoom level fit without scrolling.
- Browser regression checks include live corrections, planner dismissal/reopening, map full screen, contact updates, simulated closure/cancellation and isolation from Amy.
- Two old harness assumptions were updated to match existing approved behavior: no consent checkbox at check-in, and the current refused-close recovery phrase. Production conversation code was not altered to satisfy tests.
- 749 Evan release tests passed (408 + 341), TypeScript, component lint and optimized build passed.

Screenshots and the full local browser report are under `work/evan-6097-promotion/planner-ui/` (ignored generated evidence). Screenshots use the synthetic test visitor, not a live customer.

Production preparation still has the previously documented email-routing choice and deployed release checks outstanding. This UI update does not grant publication approval or start another live test.
