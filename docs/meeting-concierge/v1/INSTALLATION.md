# Meeting Concierge v1

Meeting Concierge v1 is the reusable X-Agent meeting-invitation flow for Google Meet, Zoom, and Microsoft Teams. Amy and Dani are the first two production adapters and prove that the same shared core supports different brands, persona boundaries, and check-in methods without sharing identity or consent.

## Module boundary

- `lib/meeting-concierge/v1/contracts.ts` defines the versioned client contract.
- `lib/meeting-concierge/v1/client.ts` contains agent-neutral browser requests and provider detection.
- `lib/meeting-concierge/v1/server.ts` validates requests, creates and removes Anam participants, rate-limits operations, and issues signed status tickets bound to both the agent and organizer.
- `lib/meeting-concierge/v1/persona-snapshot.ts` creates a meeting-scoped persona snapshot from the agent's saved Anam persona. This is where a website-only close tool can be swapped for Anam's native meeting `end_call` tool without changing the saved persona.
- `components/meeting-concierge/v1/MeetingConcierge.tsx` owns the accessible three-step interaction.
- Each agent supplies a client adapter, a thin API route/server adapter, and a branded shell/CSS module.

## Install for the next agent

1. Add `lib/meeting-concierge/v1/adapters/<agent>-client.ts`. Set only that agent's name, canonical return route, API route, copy, wake name, and existing check-in callback. Use `credentials` for a one-step private check-in or `email-code` for an existing two-step OTP flow; do not invent a third identity system.
2. Add `app/api/anam/<agent>/meetings/route.ts`. Resolve the agent's persona through its established configuration. Supply only that agent's browser/session reader, organizer identity, consent/contact-purpose check, signing secret, and rate limiter. Export the shared `GET`, `POST`, and `DELETE` handlers.
3. Add a branded shell that renders the shared `MeetingConcierge` component and maps its CSS module to `MeetingConciergeStyleContract`. Do not fork the shared interaction.
4. Route an explicit `?meeting=google|zoom|teams` entry to the shell. Keep the agent's normal conversation CTA and session route unchanged.
5. Add the isolation assertions described below and run the focused test, type check, lint, full suite, production build, and a real provider smoke test.

### Optional participation modes

An agent may opt into the shared `observer`, `participant`, and `facilitator` contract without changing the other adapters. Add the mode labels to that agent's client adapter and the exact allowed modes plus a safe default to its server adapter. The shared server rejects unsupported values and limits Observer and Facilitator to group calls.

Build the mode behavior as a meeting-scoped prompt suffix in the agent route. Keep the saved website persona and knowledge files unchanged unless the same behavior is also required for invitations created directly in Anam Lab. Treat a typed meeting objective as untrusted descriptive context: normalize it, keep it bounded, and state explicitly that it cannot override behavioral rules, expand authority, establish facts, or become memory.

Dani is the reference implementation. Observer is her corporate-safe default, one direct activation permits one short response, and the meeting snapshot returns her to silence after every contribution. Her group-call voice profile also lowers response eagerness and waits longer through mid-sentence pauses. These controls improve turn discipline but do not authenticate individual speakers or make LLM compliance deterministic.

## Exit and usage controls

- Organizer removal uses `DELETE /v1/meetings/invites/{id}` behind the agent's authenticated X Agents route. The browser sends only its opaque HMAC ticket; it never receives or submits the raw provider invite ID.
- The shared UI keeps the active invitation in agent-namespaced browser storage. Reloading the same route restores monitoring and the removal control. Stored controls expire locally after eight days.
- A meeting-scoped persona snapshot copies the saved persona's avatar, voice, LLM, prompt, tools, and provider settings at invitation time. Remove that agent's website-only close tool and every other client tool whose handler exists only in the website, then add Anam's native `end_call` tool. Keep server RAG/system tools that are valid in native meetings. Never attach another agent's tool.
- Add a short meeting-only prompt suffix: an explicit request directed at the agent to leave is confirmed intent, needs no follow-up confirmation, and invokes `end_call` exactly once. Casual thanks alone is not closing intent.
- Set `maxSessionLengthSeconds` through the shared duration choices. This bounds abandoned sessions even if the organizer closes the X Agents page.
- Organizer removal and spoken self-exit are independent safety paths. Test both in a real provider meeting before release.

## Native-meeting boundary

- Version 1 schedules, monitors, and removes the Anam participant. It does not bind a native Google Meet, Zoom, or Teams session into the website session spine.
- Do not promise a transcript, recap email, returning memory, Hermes review, or other website post-session workflow from this module. Those require a separate provider-session ingestion module.
- Agent check-in may reuse an existing identity flow to protect invitation controls, but the UI must state this boundary plainly.

## Non-negotiable isolation

- Never import another agent's route, cookie, browser identity, contact token, memory store, persona ID, provider configuration, or AgentMail handler.
- Never hardcode a persona UUID in the module. Use the agent's existing server-side resolver and environment contract.
- Preserve the agent's existing consent semantics; Meeting Concierge must not create a parallel consent or contact system.
- Keep AgentMail downstream of the agent's existing session workflow. The module must not send, suppress, or redirect agent follow-up email.
- Status polling uses an opaque HMAC ticket bound to `agentKey` and the organizer's isolated browser identity. Never expose or accept a raw Anam invite ID from the browser.
- Organizer removal must verify the same agent-and-organizer ticket again, use a separate rate-limit scope, and remain idempotent for terminal invitations.
- Keep client labels, rate-limit scopes, URLs, and UI data attributes namespaced by the adapter's `agentKey`.

## Amy reference adapter

- Client: `lib/meeting-concierge/v1/adapters/amy-client.ts`
- Server: `app/api/anam/amy/meetings/route.ts`
- Brand shell: `components/amy/AmyMeetingScheduler.tsx`
- Entry point: `/agents/amy?meeting=google`
- Existing private session (unchanged): `/demo/amy?variant=cara4&audioBridge=voicemeeter`

## Dani reference adapter

- Client: `lib/meeting-concierge/v1/adapters/dani-client.ts`
- Server: `app/api/anam/dani/meetings/route.ts`
- Brand shell: `components/dani/DaniMeetingScheduler.tsx`
- Entry point: `/agents/dani?meeting=google`
- Existing private session (unchanged): `/demo/dani`
- Check-in: Dani's existing verified-email OTP with follow-up consent; returning memory remains separately disabled unless the visitor explicitly enables it through Dani's normal memory flow.

Run `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test tests/meeting-concierge-v1.test.mjs` for the module and isolation contract.
