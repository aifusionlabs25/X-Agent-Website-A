# Dani AI Solutions Director v2

Status: **live-verified Anam configuration and managed source of truth**  
Prepared: 2026-08-09

This package expands Dani from an X-Agent-only showcase role into AI Fusion Labs' general AI solution discovery and meeting-support role while preserving the existing action-honesty, grounding, privacy, and rollback controls.

## Recommended identity

- Spoken name: `Dani`
- Display title: `AI Solutions Director`
- Full introduction: `Dani, the AI Solutions Director at AI Fusion Labs`
- Existing Cara 4 avatar and Rachel voice may remain unchanged.
- The word `Director` describes Dani's role in the experience. It does not grant human, officer, contracting, pricing, or delivery authority.

## Runtime model

The same published Dani identity can be used in two live surfaces:

1. **Website showcase:** Dani greets a visitor, performs light discovery, compares solution patterns, and frames what should be validated.
2. **Anam group meeting:** Anam's group-call mode handles silent entry and display-name gating. The prompt governs Dani's concise, advisory behavior after she is directly invoked.

Post-call work is not a third speaking mode. It is a backend workflow that waits for the final authoritative Anam transcript and then creates the approved three-email bundle.

## Contents

- `DANI_AI_SOLUTIONS_DIRECTOR_SYSTEM_PROMPT_2026-08-09.md`: unified website and meeting-safe voice prompt.
- `knowledge/`: eleven public-safe retrieval documents, including a deliberately limited professional company/founder profile.
- `knowledge-manifest.json`: versioned knowledge-group definition with the pinned live v2 group ID and exact hashes.
- `CAPABILITY_CLAIMS_AND_APPROVALS.md`: internal evidence register and unresolved business approvals. Do not upload it to Anam knowledge.
- `POST_CALL_EMAIL_SOP.md`: backend-owned Admin, Call Summary, and prospect thank-you contract. Do not upload it to public knowledge.
- `DANI_POST_CALL_EMAIL_PROMPT_BLOCK.md`: website-only tool policy, incorporated into the canonical prompt after the verified backend was implemented.
- `QA_SCENARIOS.md`: website, meeting, retrieval, privacy, and post-call promotion tests. Do not upload it to Anam knowledge.

## Deployment boundaries

- Do not overwrite the current v1 files or the protected Cara 3 rollback persona.
- Create or reuse a dedicated v2 knowledge group named `Dani AI Solutions Director Anam KB 2026-08-09 v2`.
- Attach a dedicated knowledge tool named `Knowledge_Dani_AI_Solutions_Director`.
- Upload only the allowlisted `knowledge/` documents.
- Do not upload client briefs, transcripts, internal approvals, email templates, private meeting notes, test fixtures, credentials, or implementation details.
- Keep `skip_turn` available.
- Keep `end_call` for website sessions, but the v2 prompt prohibits unauthenticated group-meeting close behavior.
- Attach `send_dani_follow_up_email` only with the verified website handler, secure typed-recipient consent gate, authoritative Anam transcript finalizer, and exactly-once delivery receipts. Native Anam meetings have no matching handler and are explicitly excluded by the prompt.
- Attach `confirm_dani_live_identity` only after the Dani-specific backend is deployed with memory fail-closed. It must never be replaced by Amy's identity tool. Manually publish and audit the Anam draft before enabling verified recall; follow [`docs/anam/DANI_RETURNING_MEMORY.md`](../../../../docs/anam/DANI_RETURNING_MEMORY.md).

## Meeting responsibility split

Anam supplies meeting joining, the visible AI disclosure, and group-call name gating. Dani's prompt supplies concise responses, privacy boundaries, prompt-injection resistance, action honesty, and meeting-safe use of context. Meeting recording, transcription, retention, and participant consent remain deployment and organizer responsibilities; they are not inferred by the persona.

## Live provider record

- Persona: `120cf627-59a6-4a35-8e70-97959a89a4da`
- Knowledge group: `0c5a31dd-44f7-4d79-95fc-b6df31bbff4f`
- Knowledge tool: `312d939d-8e3f-45f5-aab1-b2b63fb5022b`
- Website email tool: `1e44a342-ca25-4c78-bbef-51cded9c8d68`
- Prompt SHA-256: `9da10faa751087237dfb5eb76b25dc937efe78e84197ba874e7f0d96a8e375b3`
- KB bundle SHA-256: `0c9b4fd42964c63dbedcb5a4cf17a19a1489cf82298b59901647dadb1f8be85a`
- Immediate and delayed provider verification: passed
- Protected Cara 3 rollback: unchanged
- Published at: `2026-08-09T18:36:27.589Z`

## Remaining website promotion checks

Deploy the website changes, verify the intended production gates, and run the opted-in, guest, revocation, duplicate-close, and three-delivery scenarios in `QA_SCENARIOS.md`. Native Anam meeting email remains outside the website pipeline.
