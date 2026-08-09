# Dani v2 capability claims and approvals

Internal operator document. **Do not upload this file to Anam knowledge.**

Owner approval recorded: 2026-08-09  
Repository status: v2 live Anam apply and delayed provider verification passed; website deployment and end-to-end email delivery remain pending

The owner explicitly authorized Dani's expansion to the AI Solutions Director concept, the broader AI Fusion Labs solution-discovery role, the v2 system-prompt and knowledge rework, and the same three-message website follow-up pattern used by the reviewed X Agent implementations.

That approval does not convert repository evidence into customer proof, approve unlimited AI services, or create native Anam meeting email coverage. Repository implementation, website deployment, live Anam configuration, and native meeting integration are separate states.

## Approved positioning and scope

- [x] Canonical public title: `Dani AI Solutions Director`.
- [x] Approved introduction: `Dani, the AI Solutions Director at AI Fusion Labs`.
- [x] Public positioning: X Agents are AI Fusion Labs' flagship product, not the full boundary of its AI work.
- [x] Company language: AI Fusion Labs designs and prototypes practical AI experiences around defined business workflows.
- [x] Dani may evaluate conversational agents, approved-knowledge assistants, research and reporting, workflow automation, AI-assisted analysis, integration, hybrid, human-review, and non-AI process patterns.
- [x] Those categories are a discovery framework. They are not a promise that every category is a generally available package or that a specific deployment has been accepted.
- [x] Group-meeting behavior: listen broadly, speak narrowly, and answer only when directly invoked by name under Anam group-call behavior.
- [x] Website follow-up audiences: prospect thank-you and working recap, AI Fusion Labs Admin record, and internal Call Summary and opportunity brief.
- [x] Website consent model: optional typed recipient and explicit pre-call opt-in, with a normal guest path that sends no prospect email.
- [x] Website action boundary: the status/revocation tool never receives an address, never means already sent, and is not available in native Anam meetings.

## Evidence-backed language safe for the v2 public KB

| Public language | Repository evidence | Boundary |
|---|---|---|
| AI Fusion Labs designs and prototypes role-specific conversational AI experiences. | `lib/agents.ts`; `config/anam/dani/`; `config/anam/evan/`; `knowledge/amy/` | Do not call every demo a customer deployment. |
| X Agents can be configured with approved knowledge, role rules, and narrow tools. | Dani and Evan managed prompts/manifests; `config/anam/amy-workbench-client-tools.json`; `config/anam/evan-move-planner-client-tool.json` | Do not imply every X Agent has every tool. |
| Current implementations demonstrate live conversation-derived working views. | `components/amy/AmyAnamWorkbench.tsx`; `lib/anam/workbench-v2.ts`; `lib/anam/evan-move-planner.ts` | These are working-view patterns, not final assessments, routes, quotes, or system-of-record updates. |
| Current implementations demonstrate authoritative transcript retrieval and structured post-session processing. | `lib/anam/session-api.ts`; `lib/anam/session-finalizer.ts`; `docs/anam/AMY_CARA4_CANARY.md` | Requires completed transcription and permitted retention; a zero-data-retention session cannot supply the normal transcript input. |
| Dani's website implementation includes an opted-in three-message bundle with final-transcript processing, revocation, content-free receipts, and duplicate prevention. | `components/dani/DaniContactGate.tsx`; `app/api/anam/dani/access/route.ts`; `lib/anam/dani-agentmail.ts`; `lib/anam/dani-agentmail-templates.ts`; `lib/anam/session-finalizer.ts`; `tests/dani-agentmail.test.mjs` | Implemented in repository source; not production-live until the site, gates, provider transcript, and all three deliveries pass end to end. Native Anam meetings are excluded. |
| AI Fusion Labs can help evaluate conversation, knowledge, research/reporting, workflow-automation, integration, analysis, hybrid, and human-process patterns. | The repository demonstrates several building blocks; the broader taxonomy is the owner-approved solution-discovery framework. | Say `evaluate` or `explore`, not `we offer every category`, until the commercial service catalog is approved. |

## Website follow-up implementation decisions

The approved repository implementation currently does the following:

- Uses a secure typed website recipient and explicit opt-in; speech is never the recipient source.
- Allows a visitor to continue as a guest without email.
- Queues the content-free intent at verified Dani session binding rather than depending on the model to remember a send call.
- Allows status lookup and durable revocation through `send_dani_follow_up_email`.
- Waits for the completed authoritative Anam transcript and durable session receipt.
- Attempts exactly one prospect, one Admin, and one Call Summary message per eligible session.
- Places a sanitized conversation timeline in the Admin message body; it does not attach a raw transcript.
- Keeps internal opportunity analysis out of the prospect message.
- Sends automatically after the eligible website session finalizes; there is no human draft-approval step in the current implementation.
- Stores content-free intent and attempt receipts rather than raw email, transcript, or generated message content in those receipts.

These are implementation facts, not proof that the code has been deployed or that production delivery is active.

## Claims intentionally not approved

- A specific customer count, customer name, case study, conversion lift, cost saving, revenue result, or ROI.
- A standard price, package, pilot, implementation timeline, capacity, response-time guarantee, or launch date.
- General availability of a weekly competitor-intelligence product.
- Public disclosure of the tax-services prospect or its work without separate authorization.
- Support for a named CRM, calendar, meeting provider, database, API, model, or data source as a guaranteed AI Fusion Labs deliverable.
- AI Fusion Labs compliance, audit, encryption, data-residency, penetration-test, or retention claims.
- The ability to provide tax, legal, medical, financial, compliance, employment, or other professional advice.
- The claim that Dani's website contact gate or three-email pipeline is production-live before site deployment, gates, and end-to-end verification succeed.
- The claim that native Anam meeting invitations can use the website three-email pipeline.
- Treating a meeting invitation address or an address spoken on a call as verified prospect follow-up consent.

## Live Anam verification and remaining production checks

- [x] Run the guarded v2 Anam apply and capture the pre-change provider backup outside the repository.
- [x] Confirm the dedicated v2 knowledge group and all ten allowlisted documents are ready and byte-identical.
- [x] Confirm the dedicated v2 RAG tool and website email tool IDs and the exact four-tool attachment.
- [x] Confirm immediate and delayed read-back of the v2 identity, prompt hash, KB attachment, model assets, voice behavior, retention settings, and tools.
- [x] Confirm the protected Cara 3 rollback persona and rollback KB group are unchanged.
- [ ] Deploy the website changes and open only the intended production gates.
- [ ] Complete one opted-in production website session and verify one prospect, one Admin, and one Call Summary delivery from the final Anam transcript.
- [ ] Verify guest, revocation, duplicate close, missing transcript, partial provider delivery, and disabled-gate behavior in the deployed environment.
- [ ] Run the live audit after deployment and record all resulting IDs and hashes in `config/anam/dani/README.md`.

## Unresolved business and native-meeting decisions

- [ ] Approve an exact commercial service catalog beyond the current solution-discovery categories.
- [ ] Decide whether the existing competitor-intelligence work may be mentioned publicly and whether it is a private engagement, prototype, demonstration, or generally available offering.
- [ ] Define a native Anam meeting recipient and follow-up consent source. The website contact token and browser handler do not exist inside a native meeting invite.
- [ ] Define native meeting session binding and exactly-once post-call delivery before promising the three-message bundle on that surface.
- [ ] Approve meeting recording/transcription disclosure, participant consent, retention, region, access, deletion, and ZDR policies.
- [ ] Decide who may supply a pre-call brief and which fields are shareable, tentative, or operator-only.
- [ ] Decide whether any meeting participant may ask Dani to leave or whether removal remains organizer-controlled.
- [ ] Decide whether future native-meeting prospect recaps send automatically or require operator review.
- [ ] Approve retention and access rules for any future meeting-intelligence artifacts.

## Approved public language

`AI Fusion Labs designs and prototypes practical AI experiences around defined business workflows. X Agents are the flagship conversational pattern, and Dani can also help evaluate whether a need is better approached through approved knowledge, research and reporting, workflow automation, system integration, analysis, or a human process change. Exact services and delivery require confirmation from an authorized AI Fusion Labs human.`

## Deployment language

Before site verification, say: `Dani v2 is live in Anam, and the website follow-up path is implemented but not yet production-confirmed.`

Only after provider and production verification may this change to: `Dani v2 is live, and the verified website three-email follow-up is active.`

Do not append `including native Anam meetings` unless a separate meeting recipient, consent, session-binding, and delivery path has been implemented and verified.
