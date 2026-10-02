# James code-free visitor email — October 1, 2026

The owner wants ongoing email functionality without asking visitors to enter
an operator code. `visitor` mode grants each new browser-owned call a server-side
email capability. Visitors see no password field and enter no access code.
This remains a bounded, fictional-details AI Fusion Labs demo, not a real-client
pilot. The structured brief, provider verification and email consent flow remain.

## What changes

- `JAMES_DEMO_EMAIL_ACCESS_MODE=visitor`, the enabled flag, valid transport
  credentials and `JAMES_DEMO_EMAIL_DAILY_SEND_LIMIT` authorize code-free calls.
  The browser sends no operator code; request-body fields cannot enable email.
  Disabled email allows notes-only calls. Invalid visitor configuration blocks
  new email-enabled calls before any provider session is started.
- Each call gets its own unique send capability and AgentMail idempotency keys.
  Duplicate clicks, concurrent sends and page reloads cannot create extra sends.
- A call's authorization lasts 24 hours from its creation, matching the short
  demo-session lifecycle. This does not limit a visitor to one lifetime call.
- Each call still allows one internal summary and one caller recap, separately.
  Sender: AI Fusion Labs Demo <james-demo@agentmail.to>. Replies and internal
  review: aifusionlabs@gmail.com. Caller: explicitly confirmed primary email.
- The signed HttpOnly browser cookie and encrypted server session establish
  ownership. No authorization capability, API key or operator code is exposed
  in the page, URL, localStorage or session response. A spoken/model request
  cannot approve or send email.
- Existing one-use sessions keep their original saved capability and expiry;
  an upgrade does not consume them again or revoke their current email review.

## Safety and operation

Post-call provider-verified closure, a complete confirmed current brief, a
confirmed primary recipient, no detected instruction leakage, and explicit
approval of both current email drafts remain required. A model tool cannot
approve or send email. Failed or unknown deliveries must not be blindly retried.
Acceptance by AgentMail is not confirmation of inbox delivery or firm review.

Code-free access does not relax the five-starts-per-ten-minutes fingerprint rate
limit or browser ownership checks. An atomic Redis reservation limits total
summary pairs and pairs to each caller address in expiring 24-hour windows.
The required total allowance accepts 1–1000 pairs; the suggested initial demo
setting is 25 pairs (at most 50 emails). A caller address permits five pairs per
window. Recipient counter keys are hashed; counters contain no intake text and
expire after 24 hours. Exhaustion or storage failure sends nothing. These are
basic demo abuse/cost controls, not a claim of production anti-bot readiness.

Consent, provider evidence and current recipient are validated before quota is
reserved. Both delivery lanes are then durably reserved before either send.
Conservative reservations are not refunded on failure or a lost concurrent
session update; this may reduce the available budget but cannot permit extra
sends. Replaying a saved delivery does not reserve another allowance or send.

Disabling the James email flag stops preparation/sending. Leaving visitor mode
revokes pending visitor authorizations as well as future code-free launches.
Configuration changes require a new deployment; do not change shared
Amy/Dani/Evan email gates. Existing one-use calls keep their saved grant through
their original expiry; the active test is not revoked by switching modes.

The default mode remains `one-use` for backward-compatible qualification and
rollback. Reverting to it requires a future `JAMES_DEMO_EMAIL_EXPIRES_AT` for new
one-use calls. Optional `reusable` mode accepts a private operator code on each
call and issues separate 24-hour call capabilities, ignoring the legacy global
deadline. Neither code mode is the intended visitor experience. No private code,
API key or live session identifiers belong in Git.

This is still a fictional-details AI Fusion Labs demo. It is not a Knowles
submission, representation, advice, confirmed firm review or callback. Real
client email/pilot readiness requires the outstanding privacy and operational
approvals and actual mailbox delivery qualification; code-free access does not
declare those completed.

## Verification

Regression tests cover code-free browser-owned calls, validated quota policy,
expiring hashed quota counters, allowance/storage failure, consent-before-quota,
per-call key separation, duplicate suppression, revocation/expiry/sender changes,
legacy compatibility, optional operator-code reuse, and the mocked HTTP lifecycle
through notes-only, one-use, reusable and visitor modes without live provider calls.
The existing brief and email safety regressions remain in scope. Production
activation and actual mailbox results are recorded separately in the private
owner handoff, not inferred from offline tests.

