# James legal-pad and email demo — October 1, 2026

## Plain-English result

This release connects the current website icon URL, `/demo/james`, to the same
legal-pad application as `/demo/james-notepad`. Both use James persona
`8a991c93-0c95-42c5-8c22-a67428946eb8`. Tokens resolve the published persona;
the website never sends a replacement prompt or KB. Anam's Lab uses this same
persona, but the website's pad/email interface is not part of Anam's own page.

The provider-side leakage correction changes only this persona's LLM from
GPT OSS 120B to GPT5Chat. The owner's latest 50,251-character prompt, knowledge
tool, end/pause tools, greeting, Cara 4 avatar, voice and retention setting remain
unchanged. A concurrent prompt revision was detected and preserved; qualification
was repeated with the revised prompt before applying the model update.

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

Configure only the operator-gated James demo before an email qualification test:

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
guarantee against spoken leakage. Actual retained tests exposed two defects:
malformed `<think< message >` followed by internal planning, and `<J>` role markers.
The earlier marker scan required a closing angle bracket and missed the malformed
case. Both observed forms now have regressions and block recap emails for review.

The spoken correction is provider-side, not caption hiding: GPT5Chat was tested
with the full published prompt and all three existing tools. GPT4.1 was rejected
after it repeated a question continuously. Two GPT5Chat samples passed the
leakage challenge, one with each prompt revision. These are bounded fictional
text-input samples with live audio/video received, not a guarantee about every
future call or a microphone/ASR/end-to-end email test. No caller email was sent.

The older Hermes Python projection synthesizes bare document names from keyword
mentions, including negated statements. This new hosted path retains the whole
source statement, such as “I do not have a summons or complaint,” without
manufacturing positive possession. Its regression test covers that failure.
The dirty Hermes Factory checkout was not overwritten; its older local pad
remains a separate implementation, not silently fixed by this web update.

## Verification

- Existing James regressions: 55 passing.
- New demo/email/security regressions: 19 passing, including observed malformed
  thinking markers and both current website James URL bindings.
- Shared session, Amy AgentMail and deployment-contract checks: 26 passing.
- Full existing website suite: 548 passing, one deliberately skipped. Windows
  CRLF checkout differences in 21 unmodified Amy/Dani fixtures were normalized
  locally only when the resulting bytes exactly matched existing manifests;
  no KB content or committed hashes changed.
- TypeScript and focused lint: passing.
- Next.js optimized build: passing after an environment-only worker restriction
  was resolved by running the build with the appropriate execution permissions.
- Browser: legal pad opens; desktop side-by-side and narrow-screen stacked
  layouts observed; no console warnings/errors during the UI-only check.
- Live fictional Anam sessions used the official Python SDK with no microphone;
  greeting, contact corrections, prompt-extraction refusal, placeholder document
  destination, advice/callback boundaries, and ending were exercised.
- Only the James persona's model association changed. No prompt or KB mutation,
  no shared/global model configuration changes, and no email sends.

Provider contract: [AgentMail send API](https://docs.agentmail.to/api-reference/inboxes/messages/send)
supports an explicit `reply_to` and returns message/thread IDs. Sender display
name is an inbox setting, not an arbitrary per-message From spoof.

Before activation, verify a dedicated sender/reply-to, provision the operator
test configuration, run one fictional end-to-end call, and check both actual
mailboxes. Do not substitute unit tests for that live qualification.

## Deployment and rollback

The initial draft preview had no matching branch-scoped session-spine settings;
its Start button was correctly disabled. Production already has enabled session
storage and the Anam key. The release must be built for production with those
existing settings, initially without assigning the current domains, then checked
before promotion. Do not promote the unconfigured ordinary preview to production.
James uses its own encrypted-state context, cookie and Redis namespace; this
release changes no Amy/Dani/Evan settings. Hosting promotion status is reported
separately after verification; this document is the release/rollback contract.

Previous production: `dpl_AsPKWyxCgP4bmiBJRX7S2LcoejzN`, source
`8a7f000ce1b88c03fe165f6eaaad9f0bf29faa78`. A hosting rollback reassigns that
deployment. Provider rollback is independent: run
`scripts/anam/update-james-qualified-model.mjs --rollback --apply` with securely
supplied `ANAM_API_KEY`. It restores only James's original GPT OSS model; it never
reverts the owner's prompt. Both helpers stop if the prompt changes again.

Qualified newest prompt SHA-256:
`6559610760f561bce8f08b322426fe9938528221b50a9653e653fd58eb9d5cb8`.
Model IDs: GPT OSS `a7cf662c-2ace-4de1-a21e-ef0fbf144bb7`;
GPT5Chat `89649f1a-feb2-4fea-be43-56baec997a93`.
Evidence sessions: malformed planning `369b5e4e-e70d-4dc9-9088-ee79df0b477d`,
role markers `5353eaca-2081-4243-8dcc-dba80ab22f2c`, rejected GPT4.1
`692a29d0-4402-4bf0-8d7f-84a61b7bd164`, GPT5Chat original prompt
`74b42829-c91e-4f3c-a77b-e13d8d818ad7`, GPT5Chat newest prompt
`fa9760b1-2e5f-4ae7-b3b7-70efc68cec46`. No real caller details are copied here.

The existing AgentMail key is configured only in production. The scoped Vercel
read returned `decrypted: false` and no value. No key was extracted, stored or
printed, and no inbox inventory or creation occurred. A dedicated sending inbox
and James sender/grant configuration remain required; the existing production key
can be used by the server without extracting it. The approved internal
destination is not automatically assumed to be the approved Reply-To address.
