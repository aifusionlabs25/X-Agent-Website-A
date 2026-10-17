# Evan natural intake reliability checkpoint

Date: 2026-10-17
Branch: `codex/evan-6097-promotion`
Candidate persona: `6097c73e-b6ef-48c5-94c7-9a95d4863b99`

## Evidence and scope

The reviewed candidate session contained a repeated origin/destination question followed by a fabricated visitor answer in one provider persona turn. The browser did not generate that text. Later, the visitor's Phoenix-to-unclear-city answer and explicit confirmation of Mesa did not populate the planner. Bare bedroom count, flexible mid-month timing, tentative storage, and customer-handled packing also exposed extraction gaps.

The archived provider transcript alone cannot establish whether the repeated output came from one generation or provider-side chunk merging. This release tightens the prompt and independently prevents unsupported agent speech from creating planner facts; it does not claim a universal model-output guarantee.

## Changes

- The candidate prompt asks once, ends the turn, and waits. It prohibits simulating the caller, removes the requirement to recap every supplied fact and always ask another question, preserves uncertainty, and requires city clarification rather than silent substitution.
- Prompt readiness pins are updated together. No model, voice, avatar, tool schema, knowledge bank, email authorization, or closing protocol is changed.
- The planner accepts a narrowly bounded city readback only after an explicit visitor confirmation, with both proposed cities already grounded in earlier visitor move context. Agent-only cities, compound/stale confirmations, and ordinary acknowledgments do not establish a route. There is no Mason-to-Mesa spelling alias.
- Possible additional stops are displayed separately and excluded from map pins and Google Maps directions. Explicit commitment, correction, or cancellation updates their state.
- Bare bedroom counts and mid-month/flexible timing are retained without inventing a calendar date. Self-packing is separated from requested packing assistance.
- Browser tool receipts include tentative notes with their limits, so speech cannot honestly call a possible stop a mapped location.
- Email intake consumes the same grounded route and packing interpretation and labels possible stops as tentative notes.

## Verification and limitations

Focused regressions, full shared tests, build, lint, browser replay, and a bounded real-SDK conversation are release gates. The browser replay uses fake SDK transport and synthetic addresses; it checks the real React/player/planner components without creating calls or emails. The separate live conversation uses synthetic typed visitor messages, a disabled microphone, one candidate session, and a 120-second cutoff. It does not validate speech recognition or the deployed website's full voice/email lifecycle.

The city-recovery guard is deliberately conservative: unresolved or lowercase unknown place names may still require the visitor to explicitly say the city. Tentative plans are not operational approvals. A human voice retest remains necessary before production promotion.

Local release results: 280 Evan checks passed; all 40 browser checkpoints passed; the full shared suite passed (559 passed, one pre-existing skip); optimized build generated 45 routes; scoped lint and whitespace checks passed. The focused shared-player lint invocation retains its existing `react-hooks/set-state-in-effect` exception without changing lint configuration.

## Release boundary

Only the existing isolated candidate environment (`amy-ceo-rehearsal`, recovery namespace `evan-6097-candidate`) may be published. Keep the public website and Amy/Dani personas unchanged. Production baseline: `dpl_3AmVsSi9cbASHK7ZTiufPy24gmho`.

Apply the candidate prompt only while it is idle, using the guarded updater with backup and read-back verification. Pair it with the new website readiness hash. Older candidate links will reject new sessions once the provider prompt changes; use the newly verified candidate link.
