# James prompt and knowledge provenance

Reviewed: 2026-07-16

## Sources accepted for firm facts

The canonical knowledge bundle uses the Knowles Law Firm public website for current practice scope and contact facts:

- `https://www.knowleslaw.org/`
- `https://www.knowleslaw.org/contact-us/`
- `https://www.knowleslaw.org/meet-our-team/`
- `https://www.knowleslaw.org/phoenix-criminal-defense-attorney/`
- `https://www.knowleslaw.org/phoenix-dui-lawyer/`
- `https://www.knowleslaw.org/mesa/`

The local X-LINK James prompt and five James knowledge documents were accepted as behavioral and safety references. Their strongest retained patterns are calm short turns, one primary question at a time, neutral clarification, separate confirmation of critical contact fields, urgency recognition, and refusing to invent tool outcomes.

## Legacy Tavus material

Older Tavus-based James repositories were reviewed only for provider-neutral conversation patterns. They were not treated as deployment or firm-fact authority because they contained conflicting scope and unsafe or obsolete action claims.

Explicitly excluded:

- Tavus persona, replica, conversation, callback, webhook, or session identifiers;
- claims that James is human or is not AI;
- hypothetical Calendly links;
- promises that an intake, appointment, email, CRM record, attorney review, or callback occurred;
- vendor-specific legal CRM material not verified as Knowles Law Firm configuration;
- a criminal/DUI-only scope or a personal-injury-only scope;
- invented office hours, fees, case results, attorney availability, response times, and legal conclusions.

## Content ownership

- Canonical system prompt: `config/anam/james-system-prompt.md`
- Knowledge manifest: `config/anam/james-kb-manifest.json`
- Canonical documents: `config/anam/james-kb/`
- Live synchronization: `scripts/anam/sync-james-cara4.mjs`
- Readiness validation: `lib/anam/james-persona-readiness.ts`

Any later factual update should change the source-controlled bundle, receive a legal-content review appropriate to the risk, create or target a new versioned knowledge group, and pass the readiness and privacy tests before the public persona is changed.
