# Amy: brief handoff and renewal discovery repair

Scope: production Amy Cara 4 only. Keep persona/avatar/voice/LLM/knowledge,
check-in, consent, memory, Meeting Concierge, and the three email delivery lanes unchanged.

## Changes

- Clear read-only artifact requests and acceptance of an actual offer can open a
  grounded working view directly. The browser and Anam tool share one session-local
  operation/receipt, avoiding duplicate revisions. No email, catalog search, memory,
  or meeting action is authorized by this helper.
- A pending view shows a visible working status. The prompt permits one brief
  reassurance only during real work, then silence. Operations time out after six
  seconds, never retry automatically, and ignore late/cancelled results.
- Provider-fallback detection handles curly apostrophes and streamed text. Recovery
  uses the committed receipt, waits for genuine pending work, or admits failure
  without requiring the visitor to repeat already-captured facts. One recovery per
  visitor turn; closing and privacy handling retain precedence.
- Renewal/AI discovery retains reported products, seat count, renewal window,
  exploratory AI initiative, desired rollout timing, and unvalidated licensing
  status separately in the working views and all three email formats.
- QA now detects the observed fallback wording and flags long possibly unfinished
  replies for review. A transcript score cannot establish audio quality by itself.

## Verification

- Amy regression suite: 81 passed, including ten new replay/coordination tests.
- Email suite: 38 passed (including existing Dani/Evan isolation coverage).
- Broader Anam suite: 403 passed, one skipped; two existing Windows CRLF/hash
  failures in Dani KB tests. Dani files and manifests were not changed.
- TypeScript and production Turbopack build passed. The local linked-dependency
  root override was removed; no preview routes ship. Optional Webpack build is not
  compatible with existing global selectors in CSS modules and is not the release builder.
- Chrome: actual Visual Brief slides and generated visitor email checked with a
  synthetic renewal scenario; key facts visible, panel fit intact, no console errors.
- Release requires GitHub Linux CI, Vercel production readiness, guarded Amy-only
  Anam prompt synchronization, and matching live prompt hash before handoff.

## Remaining live check

Start a new session through https://xagent.aifusionlabs.app/agents/amy.
Supply renewal/products/seats/AI facts, accept Amy's brief offer, request one
correction, then close. Confirm a single displayed revision per request, no
unsupported completion claim, and the same facts in all three emails.

Upstream cause is not proven: session ad7d8a06-ee65-4d90-b0e3-df86fe01e559
exposed three thinking fallbacks, while only one display-tool call was recorded
and it succeeded. Anam engine traces would be needed to explain those failures.
This release hardens local behavior; it does not claim to eliminate every possible
provider/model interruption. No support ticket or live test email was sent.

Rollback requires both the prior website commit bfd38fb4c148e752e16123b661ae1a0b61d9934e
and the corresponding protected Amy prompt backup. Do not roll back unrelated
personas/tools or replay old email jobs.
