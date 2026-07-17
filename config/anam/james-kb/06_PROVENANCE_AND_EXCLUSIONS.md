# James Knowledge Provenance and Exclusions

Bundle version: `JAMES_KB_2026_07_16`

## Current authoritative sources

- Knowles Law Firm homepage: https://www.knowleslaw.org/
- Contact and office locations: https://www.knowleslaw.org/contact-us/
- Firm/team background: https://www.knowleslaw.org/meet-our-team/
- Criminal-defense overview: https://www.knowleslaw.org/phoenix-criminal-defense-attorney/
- DUI overview: https://www.knowleslaw.org/phoenix-dui-lawyer/
- Mesa practice overview: https://www.knowleslaw.org/mesa/

Sources were reviewed July 16, 2026. Firm information can change. When a visitor needs current confirmation, direct them to the firm.

## Legacy sources consulted for conversation design

- `Knowles Law Firm_James/# Agent System Prompt James (Tavus.txt`
- `Knowles Law Firm_James/# Agent Persona Context Knowles Law.txt`
- `Knowles Law Firm_James/lib/james-prompt.ts`

The legacy sources conflicted: some limited James to criminal defense and DUI, while another limited him to personal injury. The current firm website confirms all three practice lanes. The new prompt and KB therefore use the current firm scope.

## Excluded legacy material

- Tavus persona, replica, conversation, webhook, Daily, and iframe instructions.
- Provider-specific greeting and session mechanics.
- Any API keys, environment values, internal IDs, or callback URLs.
- The hypothetical Calendly link from the personal-injury prototype.
- Claims that James is human or “not an AI.”
- Any unverified promise of scheduling, follow-up, email, CRM entry, attorney review, case acceptance, or response time.
- Legal strategy, legal advice, deadline calculations, predicted outcomes, and case-value estimates.
