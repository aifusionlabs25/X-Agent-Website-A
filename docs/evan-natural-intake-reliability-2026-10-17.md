# Evan natural intake reliability checkpoint

Date: 2026-10-17
Branch: `codex/evan-6097-promotion`
Candidate persona: `6097c73e-b6ef-48c5-94c7-9a95d4863b99`

## Evidence and scope

The reviewed candidate session contained a repeated origin/destination question followed by a fabricated visitor answer in one provider persona turn. The browser did not generate that text. Later, the visitor's Phoenix-to-unclear-city answer and explicit confirmation of Mesa did not populate the planner. Bare bedroom count, flexible mid-month timing, tentative storage, and customer-handled packing also exposed extraction gaps.

The archived provider transcript alone cannot establish whether the repeated output came from one generation or provider-side chunk merging. This release tightens the prompt and independently prevents unsupported agent speech from creating planner facts; it does not claim a universal model-output guarantee.

## Changes

- The candidate prompt asks once, ends the turn, and waits. It prohibits simulating the caller, removes the requirement to recap every supplied fact and always ask another question, preserves uncertainty, and requires city clarification rather than silent substitution.
- A bounded real-SDK test of the first revision did not reproduce the within-turn self-answer, but manual transcript review found repeated date requests while the fixed visitor inputs supplied other information. A second prompt refinement explicitly accepts unknown fields, follows new caller details instead of repeating an unanswered question on successive turns, and prohibits combining unrelated intake topics. The follow-up test explicitly supplies an unknown date to exercise that boundary.
- Prompt readiness pins are updated together. No model, voice, avatar, tool schema, knowledge bank, email authorization, or closing protocol is changed.
- The planner accepts a narrowly bounded city readback only after an explicit visitor confirmation, with both proposed cities already grounded in earlier visitor move context. Agent-only cities, compound/stale confirmations, and ordinary acknowledgments do not establish a route. There is no Mason-to-Mesa spelling alias.
- Possible additional stops are displayed separately and excluded from map pins and Google Maps directions. Explicit commitment, correction, or cancellation updates their state.
- Bare bedroom counts and mid-month/flexible timing are retained without inventing a calendar date. Self-packing is separated from requested packing assistance.
- Browser tool receipts include tentative notes with their limits, so speech cannot honestly call a possible stop a mapped location.
- Email intake consumes the same grounded route and packing interpretation and labels possible stops as tentative notes.

## Verification and limitations

Focused regressions, full shared tests, build, lint, browser replay, and a bounded real-SDK conversation are release gates. The browser replay uses fake SDK transport and synthetic addresses; it checks the real React/player/planner components without creating calls or emails. The separate live conversation uses synthetic typed visitor messages, a disabled microphone, one candidate session, and a 120-second cutoff. It does not validate speech recognition or the deployed website's full voice/email lifecycle.

The city-recovery guard is deliberately conservative: unresolved or lowercase unknown place names may still require the visitor to explicitly say the city. Tentative plans are not operational approvals. A human voice retest remains necessary before production promotion.

Local release results: 282 Evan checks passed; all 40 browser checkpoints passed; the full shared suite passed (559 passed, one pre-existing skip); optimized build generated 45 routes; scoped lint and whitespace checks passed. The focused shared-player lint invocation retains its existing `react-hooks/set-state-in-effect` exception without changing lint configuration.

## Release boundary

Only the existing isolated candidate environment (`amy-ceo-rehearsal`, recovery namespace `evan-6097-candidate`) may be published. Keep the public website and Amy/Dani personas unchanged. Production baseline: `dpl_3AmVsSi9cbASHK7ZTiufPy24gmho`.

Apply the candidate prompt only while it is idle, using the guarded updater with backup and read-back verification. Pair it with the new website readiness hash. Older candidate links will reject new sessions once the provider prompt changes; use the newly verified candidate link.

## Published candidate verification

- Runtime source checkpoint: `0280171` (following implementation checkpoint `0da4454`), pushed to the existing candidate branch.
- Deployment: `dpl_5cV7FxH9J8ogiiQo7bieEjYwb4uK`, READY. URL: https://x-agent-website-bh5ef5rli-robs-projects-e72bad73.vercel.app/demo/evan (Vercel protection requires the temporary share link supplied in the chat). Next.js 16.4.1; cloud build approximately 28 seconds from build start to ready.
- Managed prompt SHA-256: `57e5551ec033f1553713b559f87aaa9172de665c5edd0d32678ca65cb331fcb2`. Candidate-only prompt update completed with zero active sessions, backup, hash read-back, and non-prompt configuration preservation verified.
- Deployed guest and synthetic-email entry checks passed: signed access cookie, correct candidate token, and email-consent isolation. No website engine session was bound and no email was sent by these checks.
- Final standalone real-SDK session `688abe8e-240f-48aa-b103-c3e1a25f2ac5` completed six checkpoints in approximately 44 seconds. Manual review found no repeated unknown-date request, within-turn duplicate question, fabricated caller route answer, or freeze. Evan responded to self-packing and delivered the prescribed farewell; the harness stopped one second after completed farewell. It still asked a broad inventory-sizing question after a one-bedroom description; this was not treated as proof of perfectly natural conversation.
- Live smoke output is private local test evidence under ignored `work/evan-6097-promotion/conversation-smoke/`. Synthetic typed messages are not proof of microphone/ASR performance, interrupted speech behavior, or actual email delivery.
- The public domain was rechecked after the final publish and still resolved to `dpl_3AmVsSi9cbASHK7ZTiufPy24gmho`. Amy/Dani personas, main, and production were not changed.
