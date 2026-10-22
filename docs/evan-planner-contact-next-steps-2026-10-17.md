# Evan planner contact notes and natural closing checkpoint

Date: 2026-10-17
Branch: `codex/evan-6097-promotion`
Candidate persona: `6097c73e-b6ef-48c5-94c7-9a95d4863b99`

## Visitor-facing changes

- Working move brief includes a compact contact column: name, phone, email, preferred contact method, and best time to reach the visitor.
- Check-in name/email stay in browser memory for the mounted session. Completed visitor utterances can update working contact notes; partial dictated numbers do not replace completed values. Names require explicit name statements or a direct answer to a name question. Display-hide history survives the general transcript's rolling limit; a newly spoken email does not resurrect a hidden check-in value. Fresh guest entry starts without previous contact data.
- A spoken email change is displayed separately as an unverified note. It does not change the secure check-in recap address, email consent, or backend delivery routing. Display-hide requests only hide planner notes; the card explicitly says recap settings remain unchanged.
- Removed the visitor-facing completeness percentages and category counts. The old metric counted six detected categories: origin plus destination, timing, property scope, services or special items, access, and care priorities. These were not six mandatory conversation goals; categories such as care priorities are not relevant to every move. Internal fields remain for compatibility, but do not grade the visitor.
- Renamed the visible Readiness tab to Next steps; retained its internal view key for tool compatibility. Show practical details to discuss and staff-review boundaries rather than a completion score.
- Reduced headings, spacing, and oversized cards. Brief/contact columns stack on mobile; content scrolls separately from the footer. Existing picture-in-picture and mobile Exit controls remain available.
- Move list distinguishes requested services from optional topics to ask Mullins about. Packing/unpacking, loading/unloading, and specialty handling are reference options, not selected services. Boxes/tape are explicitly subject to availability confirmation. Reference: https://www.mullins-moving.com/services
- Fixed tentative multi-stop parsing for the actual Mesa -> storage in Gilbert -> eventual house in Queen Creek wording. Tentative details remain labeled as uncertain; no exact address or availability is inferred.

## Closing investigation and fix

Read-only review of recent Anam sessions confirmed that the website guard rejected two `end_mullins_session` calls after a visitor said they had enough for now and asked for a morning callback. A later explicit goodbye was accepted. Another recent session used a clear final statement that they were good to end.

The Evan-only intent guard now accepts both observed natural endings, including a narrowly bounded callback handoff after an unambiguous wrap-up. Questions, new details, negation, partial speech, ordinary confirmations, and scoped statements such as being done with packing still cannot authorize hangup. Resumed visitor speech still cancels a pending close.

A separate successful farewell had an approximately ten-second delay before the provider session ended. Server evidence does not prove which browser close event occurred. Added content-free close-phase diagnostics (accepted farewell, interruption, stop reason) without reducing the safety fallback or changing Amy/Dani behavior.

## Validation

- Evan release suite: 252 passed.
- Browser harness: 38 checkpoints passed, including actual shared-player lifecycle, natural closing phrases, interruption safety, completed contact corrections, long-call display-hide retention, guest isolation, route changes, and 1366x768 / 1100x620 / 390x844 layouts.
- Full existing npm test suite passed again on the final implementation.
- Final production build: passed, 45 routes generated.
- Changed-file ESLint: passed with the existing shared-player set-state-in-effect rule excluded for this focused invocation; no lint configuration changed.
- Browser tests use local fake tokens and tool endpoints; they do not create real calls or send emails.

## Release boundary

Publish only to the existing isolated candidate environment with recovery namespace `evan-6097-candidate`. Do not promote production or merge main. No Anam persona, system prompt, knowledge bank, or provider configuration was changed by this checkpoint. Production baseline before publication: `dpl_3AmVsSi9cbASHK7ZTiufPy24gmho`.

The deployed access/token smoke test must verify both email and guest entry. A new human voice call remains the final real-world validation for ASR wording and farewell timing.
