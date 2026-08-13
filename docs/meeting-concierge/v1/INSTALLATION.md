# Meeting Concierge v1

Meeting Concierge v1 is the reusable X-Agent meeting-invitation flow for Google Meet, Zoom, and Microsoft Teams. Dani is implementation one and the production behavioral reference; Dani remains unchanged. Amy is implementation two and the first adapter-backed consumer of the versioned shared core.

## Module boundary

- `lib/meeting-concierge/v1/contracts.ts` defines the versioned client contract.
- `lib/meeting-concierge/v1/client.ts` contains agent-neutral browser requests and provider detection.
- `lib/meeting-concierge/v1/server.ts` validates requests, calls Anam, rate-limits operations, and issues signed status tickets bound to both the agent and organizer.
- `components/meeting-concierge/v1/MeetingConcierge.tsx` owns the accessible three-step interaction.
- Each agent supplies a client adapter, a thin API route/server adapter, and a branded shell/CSS module.

## Install for the next agent

1. Add `lib/meeting-concierge/v1/adapters/<agent>-client.ts`. Set only that agent's name, canonical return route, API route, copy, wake name, and existing check-in callback.
2. Add `app/api/anam/<agent>/meetings/route.ts`. Resolve the agent's persona through its established configuration. Supply only that agent's browser/session reader, organizer identity, consent/contact-purpose check, signing secret, and rate limiter.
3. Add a branded shell that renders the shared `MeetingConcierge` component and maps its CSS module to `MeetingConciergeStyleContract`. Do not fork the shared interaction.
4. Route an explicit `?meeting=google|zoom|teams` entry to the shell. Keep the agent's normal conversation CTA and session route unchanged.
5. Add the isolation assertions described below and run the focused test, type check, lint, full suite, production build, and a real provider smoke test.

## Non-negotiable isolation

- Never import another agent's route, cookie, browser identity, contact token, memory store, persona ID, provider configuration, or AgentMail handler.
- Never hardcode a persona UUID in the module. Use the agent's existing server-side resolver and environment contract.
- Preserve the agent's existing consent semantics; Meeting Concierge must not create a parallel consent or contact system.
- Keep AgentMail downstream of the agent's existing session workflow. The module must not send, suppress, or redirect agent follow-up email.
- Status polling uses an opaque HMAC ticket bound to `agentKey` and the organizer's isolated browser identity. Never expose or accept a raw Anam invite ID from the browser.
- Keep client labels, rate-limit scopes, URLs, and UI data attributes namespaced by the adapter's `agentKey`.

## Amy reference adapter

- Client: `lib/meeting-concierge/v1/adapters/amy-client.ts`
- Server: `app/api/anam/amy/meetings/route.ts`
- Brand shell: `components/amy/AmyMeetingScheduler.tsx`
- Entry point: `/agents/amy?meeting=google`
- Existing private session (unchanged): `/demo/amy?variant=cara4&audioBridge=voicemeeter`

Run `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test tests/meeting-concierge-v1.test.mjs` for the module and isolation contract.
