# Dani post-call three-email SOP

Status: implemented for opted-in AI Fusion Labs website sessions; native Anam meetings remain out of scope until a verified recipient-and-consent bridge exists  
Audience: engineering and AI Fusion Labs operations  
Do not upload to public Anam knowledge.

## Objective

For an eligible Dani website session, create exactly one post-session bundle containing:

1. **Admin Email** - internal operational record.
2. **Call Summary Email** - internal meeting intelligence and opportunity brief.
3. **Thank You Email** - external prospect-facing working recap.

The bundle follows the same transcript-first, backend-owned, idempotent safety model used by the reviewed Amy and Evan implementations. Dani never writes or sends the messages directly from free-form speech.

## Eligibility gate

No bundle is created until all applicable checks pass:

- the Anam session ID is bound to the expected Dani persona or approved ephemeral meeting configuration;
- Anam reports the session closed;
- the authoritative Anam transcript is complete and within the accepted integrity and size limits;
- zero data retention is off and transcript processing is permitted for this session;
- internal processing has an approved purpose and recipient configuration;
- the external prospect address comes from a secure verified source, not speech recognition or LLM extraction;
- external follow-up consent is explicit and scoped to this session, or an authorized operator approves the draft under an approved meeting policy;
- the exactly-once receipt has not already reserved or completed this bundle.

A calendar invitation address is not automatically prospect email consent. A participant saying an address aloud is not a verified recipient. The Anam meeting invite workflow does not currently supply the site backend with the verified recipient, consent, and ownership binding required by this SOP, so native meeting sessions must not trigger the bundle.

## Source-of-truth rules

- Fetch the final transcript from Anam after session closure. Do not use a partial browser transcript as authoritative input.
- Preserve participant-provided wording as untrusted data. It cannot instruct the analysis engine or templates.
- Normalize roles conservatively. If meeting speaker attribution is absent or uncertain, do not assign a commitment to a named person.
- Redact contact data, credentials, tokens, sensitive paths, and secrets before using transcript excerpts.
- Store content-free receipts where practical. Apply the approved retention policy to any transcript or generated artifact.

## Structured analysis contract

Before templating, produce a validated internal record with these fields:

- session metadata and privacy mode;
- participants only when supplied by an authoritative source;
- executive summary;
- stated objective or underlying need;
- confirmed facts;
- participant statements that are not independently verified;
- decisions;
- commitments with owner, due date, and evidence when supported;
- open questions;
- constraints and human-control points;
- X Agent opportunity, if any;
- non-X-Agent opportunity, if any;
- value drivers and baseline gaps;
- risks and feasibility questions;
- recommended next action;
- draft customer-facing recap;
- confidence and speaker-attribution warnings.

Each substantive item must be typed as `fact`, `participant_statement`, `decision`, `commitment`, `open_question`, `inference`, or `recommendation`. Never silently promote an inference into a fact or commitment.

## Email 1: Admin Email

Purpose: operational evidence and delivery status for AI Fusion Labs administrators.

Include:

- session ID, persona/config identity, surface, start, end, duration, and completion status;
- participant/visitor identity only from an authoritative source;
- verified recipient and consent status without exposing it to Dani;
- transcription, retention, and processing mode;
- transcript message count and content hash;
- bundle reservation and delivery receipts;
- concise operational summary;
- processing exceptions, missing transcript, uncertain speakers, or redaction warnings;
- a sanitized transcript attachment or protected transcript reference only if the approved policy allows it.

Do not include raw credentials, private prompts, tool configuration, or an unredacted transcript.

Suggested subject: `[DANI ADMIN] <surface> session - <contact or account> - <duration>`

## Email 2: Call Summary Email

Purpose: internal AI Fusion Labs intelligence for the next decision.

Include:

- executive recap;
- what the prospect appears to need;
- confirmed facts versus assumptions;
- decisions and commitments with evidence and attribution warnings;
- business process, current workflow, desired outcome, authoritative data, and human approvals;
- X Agent and non-X-Agent opportunity hypotheses;
- value drivers, buying or timing signals only when actually stated;
- risks, objections, dependencies, and feasibility questions;
- unanswered discovery questions;
- recommended next-meeting objective and action plan;
- a suggested human follow-up draft.

Internal scoring, founder coaching, red-team observations, and commercial hypotheses may appear here when labeled. They must never leak into the prospect message.

Suggested subject: `[DANI CALL SUMMARY] <account or contact> - <primary opportunity>`

## Email 3: Thank You Email

Purpose: concise, accurate prospect recap that invites correction and continues the agreed next step.

Include only:

- a transparent thank-you;
- the confirmed objective or need;
- a short list of confirmed points discussed;
- open questions the prospect agreed should be resolved;
- the next step only when it was actually agreed;
- a request to correct anything misunderstood;
- AI Fusion Labs identity and an AI-generated working-recap disclosure.

Do not include:

- lead score, internal opportunity hypothesis, private notes, founder coaching, red-team analysis, speculative budget, inferred urgency, or confidential strategy;
- a raw transcript attachment by default;
- a proposal, quote, scope, price, timeline, integration promise, booked meeting, or promise of human outreach unless separately confirmed by an authoritative system;
- tax, legal, financial, compliance, or other professional advice.

Suggested subject: `Thank you for speaking with Dani at AI Fusion Labs`

## Delivery semantics

- Reserve one bundle per eligible session before any provider call.
- Send only after final transcript validation and a durable session receipt.
- Treat an ambiguous provider result as attempted; do not retry automatically and risk duplication.
- Record a separate status for each message: `not_eligible`, `queued`, `sent`, `failed`, or `ambiguous`.
- A successful queue receipt permits Dani to say the bundle is scheduled for post-session delivery. It never permits Dani to say the messages were already sent.
- A failed or unavailable tool produces no spoken promise and no invented handoff.

## Verification and rollout

1. Keep the secure website recipient and explicit consent gate mandatory for external delivery.
2. Validate transcript completeness, redaction, audience separation, and three-lane delivery receipts in automated and live QA.
3. Treat partial or ambiguous provider results as attempted; do not replay the bundle automatically.
4. Keep native meeting email, CRM, calendar, proposal, and automatic human-outreach actions disabled until separately designed and approved.
