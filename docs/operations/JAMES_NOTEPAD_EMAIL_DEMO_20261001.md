# James legal-pad and email demo — October 1, 2026

## Plain-English result

A separate `/demo/james-notepad` route uses the current James persona,
`8a991c93-0c95-42c5-8c22-a67428946eb8`, with the owner's published prompt,
voice, avatar and knowledge files. No provider settings or knowledge files are
overridden or updated by this change. The public `/demo/james` is unchanged.

Show legal pad opens the yellow lined notepad beside James on desktop. Smaller
screens stack it below the video. Finalized speech updates the notes; supported
corrections preserve history. Closing the call verifies its transcript and
preserves an organized, source-bound summary. This is category sorting, not a
new generative rewrite of the caller's facts.

The email module now prepares two separate AI Fusion Labs demo messages:

- A detailed internal review summary to `aifusionlabs@gmail.com`.
- A caller recap to the primary email explicitly confirmed in the conversation.

Neither email claims submission to Knowles, legal advice, representation, firm
review, a callback or a deadline. Internal status/evidence identifiers are not
included in the caller recap. Every email is sent separately, without CC/BCC.

## Safety and activation

Email is **off by default**. Ordinary visitors can use notes but cannot send.
One operator capability authorizes one session and at most two email attempts;
it expires within 24 hours. It is entered in a password field, sent only in a
start/preflight header, never placed in a URL or saved in browser storage.

After provider-verified closure, the caller reviews both draft bodies, recipient,
sender and reply-to, then explicitly approves the fictional-demo use and mailbox
permission. A changed snapshot invalidates approval. A confirmed caller email,
complete intake state, active demo authorization and configured sender are
required. A model tool invocation cannot authorize either send.

Both send reservations are atomically persisted before either email is attempted.
Retries are deliberately disabled. Failed/unknown results and a storage failure
after provider acceptance must be reconciled by an operator, not resent. Provider
receipts are retained server-side, not exposed in the new browser response.
“Accepted by AgentMail” does not mean inbox delivery or human review.

Configure only the dedicated demo environment/branch before a qualification test:

| Server-only setting | Required value |
| --- | --- |
| `JAMES_DEMO_EMAIL_ENABLED` | `true` only for the authorized test |
| `JAMES_AGENTMAIL_API_KEY` | Dedicated key, or the existing `AGENTMAIL_API_KEY` |
| `JAMES_AGENTMAIL_ADDRESS` | Dedicated James sending inbox; no Amy fallback |
| `JAMES_DEMO_REPLY_TO` | Owner-approved reply address |
| `JAMES_DEMO_EMAIL_ACCESS_SHA256` | SHA-256 digest of a fresh random 32-byte base64url code |
| `JAMES_DEMO_EMAIL_EXPIRES_AT` | UTC ISO timestamp no more than 24 hours ahead |

The sending inbox must exist with the exact display name `AI Fusion Labs Demo`.
Preflight checks that identity with AgentMail. No custom-domain verification,
inbox creation, secret changes, enabled sends, or real email deliveries are
implied by a passing provider-free test. Do not commit access codes or keys.

The hosted storage uses existing session-spine configuration, but separate
cookies, launch labels, authenticated encryption context and Redis namespace:
`xagent:james:notepad-demo:v1:`. Notes expire 24 hours after their last update;
Anam reports and email copies have independent retention. The owner's retention
acceptance is demo-only; resolve the real-client privacy gate before a pilot.

## Instruction leakage and the older Hermes pad

Caption diagnostics identify explicit internal-instruction markers and block
summary emails for review. They do not modify the conversation or filter audio.
The native provider streams speech independently; a text-event filter is not a
guarantee against spoken leakage. No speculative prompt/model/voice changes
were made. An actual example or session/time remains necessary to isolate the
reported intermittent spoken issue.

The older Hermes Python projection synthesizes bare document names from keyword
mentions, including negated statements. This new hosted path retains the whole
source statement, such as “I do not have a summons or complaint,” without
manufacturing positive possession. Its regression test covers that failure.
The dirty Hermes Factory checkout was not overwritten; its older local pad
remains a separate implementation, not silently fixed by this web update.

## Verification

- Existing James regressions: 55 passing.
- New demo/email/security regressions: 17 passing.
- Shared session, Amy AgentMail and deployment-contract checks: 26 passing.
- TypeScript and focused lint: passing.
- Next.js optimized build: passing after an environment-only worker restriction
  was resolved by running the build with the appropriate execution permissions.
- Browser: legal pad opens; desktop side-by-side and narrow-screen stacked
  layouts observed; no console warnings/errors during the UI-only check.
- No live Anam call started, no provider prompt or KB mutation, no email sent.

Provider contract: [AgentMail send API](https://docs.agentmail.to/api-reference/inboxes/messages/send)
supports an explicit `reply_to` and returns message/thread IDs. Sender display
name is an inbox setting, not an arbitrary per-message From spoof.

Before activation, verify a dedicated sender/reply-to, provision the operator
test configuration, run one fictional end-to-end call, and check both actual
mailboxes. Do not substitute unit tests for that live qualification.

## Preview configuration audit

The feature was pushed as a draft review, not merged to main. The Vercel preview
renders the interface but has no matching branch-scoped session-spine secret,
enable/kill settings, or Redis URL/token. Its Start button is therefore disabled
with a visible layout-preview notice. Anam's key is present for preview, but
that alone does not make a call ready. Configure separate demo storage rather
than borrowing production credentials or the expired older planner branch.

The existing AgentMail key is configured only in production. The scoped Vercel
read returned `decrypted: false` and no value. No key was extracted, stored or
printed, and no inbox inventory or creation occurred. A dedicated sending inbox
and usable server-side demo credentials remain required. The approved internal
destination is not automatically assumed to be the approved Reply-To address.
