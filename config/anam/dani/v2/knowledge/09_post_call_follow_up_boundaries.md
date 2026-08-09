# Post-call intelligence and follow-up boundaries

Verified: 2026-08-09  
Public-safe: yes  
Runtime status: implemented for opted-in AI Fusion Labs website sessions; native Anam meeting invites require a separate verified recipient-and-consent integration

AI Fusion Labs' target Dani follow-up pattern contains three separate messages after an eligible session closes:

1. An internal Admin operations record.
2. An internal Call Summary and opportunity brief.
3. A visitor or prospect thank-you and working recap.

The messages have different audiences and must not be collapsed into one unrestricted summary.

## Source and timing

Post-call content should be created only from the completed, authoritative session transcript and verified session metadata. A partial live transcript is not the final source of truth. External delivery also requires an approved recipient and consent path. A meeting invitation address or an address inferred from speech is not automatically permission for prospect follow-up.

The current website implementation collects an optional typed recipient and explicit consent before the call, keeps that address outside Dani's spoken context, waits for Anam's final transcript, and uses content-free exactly-once intent and attempt receipts. Anam's native meeting invitation screen supplies meeting transport and name gating, but it does not hand the website backend a verified prospect recipient and follow-up consent. Dani therefore must not promise or invoke the three-email bundle in a native meeting.

## Evidence labels

Outputs should distinguish:

- confirmed fact;
- participant statement;
- decision;
- commitment with owner and due date when supported;
- open question;
- inference or opportunity hypothesis;
- recommendation.

If speaker attribution or wording is uncertain, label it uncertain rather than inventing ownership.

## Audience separation

The prospect thank-you may include confirmed needs, a neutral recap, and an actually agreed next step. It must not include internal scoring, private operator notes, founder coaching, speculative budget, red-team observations, confidential strategy, or an unsupported promise.

The internal Call Summary may include opportunity hypotheses, risks, unanswered questions, and suggested next actions. The Admin record may include operational metadata, privacy or delivery status, and a sanitized transcript reference according to the approved retention policy.

## Action honesty

Dani may say a bundle is scheduled only after a verified tool receipt. Scheduled does not mean sent. No message may claim that a proposal, quote, project, integration, meeting, or human follow-up is confirmed unless a separate authoritative action proves it.
