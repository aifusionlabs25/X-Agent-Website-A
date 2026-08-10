# Dani Anam configuration

This directory is the managed source for the Cara 4 Dani persona used by `x-agent-website-a`.

## Current status: v2 live in Anam; website deployment pending

The owner approved Dani's expansion to **Dani AI Solutions Director**, the broader AI Fusion Labs discovery role, and the website three-email follow-up on 2026-08-09.

The v2 Anam apply completed on 2026-08-09. Immediate and delayed provider read-backs verified the exact prompt, models, four-tool set, dedicated knowledge group, and all eleven document bytes. The repository also contains the website follow-up implementation; that path is not production-confirmed until the site deploy and end-to-end delivery test pass.

Implementation status:

| Area | Repository state | Live/provider state |
|---|---|---|
| V2 prompt, identity, and eleven-file KB | Managed source of truth | Live in Anam; immediate and delayed read-backs passed |
| Website contact gate and three-email pipeline | Implemented and covered by Dani tests | Requires site deployment, open production gates, and an end-to-end provider test |
| Dedicated returning-memory boundary | Dani-specific session/contact secrets, verified identity, consent, encrypted records, and operator promotion are implemented | Keep closed until the staged backend, Anam tool/prompt, manual-publish, and verification runbook passes |
| Anam group-call participation | V2 prompt and KB define silent, name-invoked advisory behavior | Anam supplies meeting transport and name gating |
| Native Anam meeting follow-up email | Explicitly excluded from the website client tool | Not implemented; no verified recipient-and-consent bridge or native meeting handler |
| Cara 3 rollback | Protected by the updater | Verified unchanged after v2 apply |

## Identity and rollback safety

- Managed Cara 4 persona: `120cf627-59a6-4a35-8e70-97959a89a4da`
- Live name: `Dani AI Solutions Director`
- Cara 4 avatar asset: `58b045b9-ac1d-4ddf-af14-18972618c57b`
- Rachel voice: `90a1acd3-4fc0-11f1-84b0-52bacf74fa75`
- GPT OSS 120B LLM: `a7cf662c-2ace-4de1-a21e-ef0fbf144bb7`
- Protected Cara 3 rollback persona: `61f0fd3e-7937-472a-958d-cdba76b33bf1`
- Protected rollback KB group: `29af2c7e-4638-4a2f-a819-b4a9e48fec0a`
- Live v2 KB group: `0c5a31dd-44f7-4d79-95fc-b6df31bbff4f`
- Live v2 knowledge tool: `312d939d-8e3f-45f5-aab1-b2b63fb5022b`
- Live website email tool: `1e44a342-ca25-4c78-bbef-51cded9c8d68`

The updater verifies the target persona, avatar, voice, LLM, and protected rollback identity before writing. It never updates or deletes the rollback persona or its knowledge group. A successful apply also requires an absolute backup directory outside the repository and performs immediate plus delayed provider verification.

## Managed v2 source

- `v2/DANI_AI_SOLUTIONS_DIRECTOR_SYSTEM_PROMPT_2026-08-09.md`: canonical website and meeting-safe spoken prompt.
- `v2/knowledge/`: eleven public-safe AI Fusion Labs, founder-profile, solution-discovery, X Agent, meeting, and follow-up documents.
- `v2/knowledge-manifest.json`: exact document allowlist, fingerprints, bundle hash, provenance, and exclusions.
- `persona-manifest.json`: pinned identity, model assets, managed prompt hash, voice behavior, and target tool inventory.
- `../dani-agentmail-client-tool.json`: website-only follow-up status and revocation tool.
- `v2/CAPABILITY_CLAIMS_AND_APPROVALS.md`: owner approvals, evidence-backed claims, and unresolved policy decisions. It is not uploaded to Anam.
- `v2/POST_CALL_EMAIL_SOP.md`: internal three-email design contract. It is not uploaded to Anam.
- `v2/QA_SCENARIOS.md`: pre-promotion regression and acceptance checks. It is not uploaded to Anam.

The v2 knowledge group is intentionally isolated from the v1 and Cara 3 rollback groups. The intended v2 knowledge tool is `Knowledge_Dani_AI_Solutions_Director`. The legacy `Knowledge_Dani_X_Agent_Director` and generic `Knowledge_Liv` tools are not repurposed.

## Website three-email pipeline

The repository implementation is limited to opted-in `x-agent-website-a` sessions:

1. The visitor either supplies a typed name and email with explicit follow-up consent or continues as a guest without email.
2. The typed address stays outside Dani's spoken context and is carried in an encrypted, session-bound, expiring contact token.
3. The verified Dani session queues a content-free, exactly-once intent at bind time. A later tool call reads status or records revocation; it does not receive an address or create a second send request.
4. After Anam reports the website session closed, the backend fetches the final authoritative Anam transcript, writes the durable session receipt, and attempts the bundle once.
5. The bundle contains exactly:
   - a prospect thank-you and working recap;
   - an AI Fusion Labs Admin operations record with a sanitized conversation timeline;
   - an internal Call Summary and opportunity brief.
6. Guest, revoked, greeting-only, missing-transcript, disabled-gate, failed, partial, duplicate, and ambiguous states fail without a false delivery claim.

`send_dani_follow_up_email` is a website-only client tool. Only `email_queued` or `email_already_queued` means the bundle is scheduled. Dani must never say it was sent before backend delivery evidence exists.

The pipeline is implemented in source, but that does not make it production-live. Production still requires the site deployment, valid server configuration, all Dani and shared session-spine gates open, a live final-transcript test, three verified deliveries, and duplicate/revocation verification.

## Returning-memory rollout

Dani's memory is isolated from Amy's cookies, secrets, identity tool, consent state, records, and promotion gate. The dedicated Anam identity tool and managed prompt are now published and audited; keep both Dani memory kill switches active until the isolated memory store and production gates are approved. The operator checklist, environment contract, fingerprint formula, smoke tests, and emergency close are in [`docs/anam/DANI_RETURNING_MEMORY.md`](../../../docs/anam/DANI_RETURNING_MEMORY.md).

## Native Anam meeting boundary

Anam's meeting feature is responsible for joining Google Meet, Zoom, or Teams and for group-call name gating. The v2 prompt tells Dani to listen broadly, answer narrowly when directly invoked, protect private context, and avoid unauthenticated actions.

The website contact gate, browser session binding, and `send_dani_follow_up_email` client handler do not run inside a native Anam meeting invite. A meeting invitation address or an address spoken on the call is not the website's verified recipient or consent. Dani therefore cannot schedule or promise the three-email bundle from a native Anam meeting until a separate recipient, consent, session-binding, and delivery integration is implemented and verified.

Meeting disclosure, transcription, retention, region, access, deletion, and zero-data-retention choices remain organizer and deployment responsibilities.

## Commands

```powershell
npm run test:anam:dani
npm run test:anam:agentmail
npm run build
npm run anam:update:dani
npm run anam:audit:dani
```

`npm run anam:update:dani` is read-only by default and prints the proposed live plan. A live apply requires the explicit confirmation and an absolute backup directory outside the repository:

```powershell
npm run anam:update:dani -- --apply --confirm=CONFIRM_DANI_CARA4_SYNC --backup-dir="C:\AI Fusion Labs\X AGENTS\BACKUPS\Dani Anam"
```

The update API creates or updates the provider draft; it does not publish that draft. After a successful provider read-back, the updater intentionally exits with code `2` and reports `manualPublishRequired: true`. Publish in Anam, record the new verified `publishedAt` baseline in `persona-manifest.json` and the runtime readiness pin, then run `npm run anam:audit:dani`. The audit and website token route reject missing or older publication metadata while allowing a later republish of the same fully verified configuration.

The Anam persona may be described as live because the guarded apply and delayed read-back passed. Do not describe the website three-email path as production-live until the website is deployed, its gates are verified, and an opted-in end-to-end call produces the three intended deliveries.

## Last verified provider baseline before v2 apply

- Live identity: `Dani X Agent Director`
- Live prompt SHA-256: `a78746a1942dea8cf40a9d2652871aee07225d96a99a9991ab4290cdbd870288`
- V1 knowledge bundle SHA-256: `bfc460c00b1d8a00ad93b5b5b74a2e76273a51548a7c28ee025a6f77944d6a29`
- V1 isolated knowledge group: `b1fb1df8-540e-4263-9735-0a6434c6bd1a`
- V1 dedicated knowledge tool: `a071c3bb-536a-4701-96ba-00fba409c012`
- V1 required tools: `Knowledge_Dani_X_Agent_Director`, `skip_turn`, `end_call`
- Eight of eight v1 documents reported ready and matched their local byte hashes.
- Immediate and delayed v1 provider read-backs passed.
- V1 pre-change provider snapshot: `C:\AI Fusion Labs\X AGENTS\BACKUPS\Dani Anam\dani-cara4-pre-sync-2026-08-09T17-27-59-641Z.json`
- The protected Cara 3 persona and its original KB group remained unchanged.

## Verified v2 provider record

- Live identity: `Dani AI Solutions Director`
- Live prompt SHA-256: `604254b51e4d6174294b354a59b5bb1d52a5c399ee7d3444b1dc877715164ebb`
- Live knowledge bundle SHA-256: `59c78f8e62ed3f30084db5d15abf981b664942f819c1e78640231080c8803ae3`
- V2 knowledge group: `0c5a31dd-44f7-4d79-95fc-b6df31bbff4f`
- V2 knowledge tool: `312d939d-8e3f-45f5-aab1-b2b63fb5022b`
- Website email tool: `1e44a342-ca25-4c78-bbef-51cded9c8d68`
- Website identity tool: `584b2e44-3827-4178-9233-a3bd69104e28`
- Exact live tools: `Knowledge_Dani_AI_Solutions_Director`, `skip_turn`, `end_call`, `send_dani_follow_up_email`, `confirm_dani_live_identity`
- Eleven of eleven v2 documents reported `READY` and matched their local byte hashes.
- Immediate and delayed v2 provider read-backs passed.
- Protected Cara 3 rollback persona remained unchanged.
- Published v2 timestamp: `2026-08-10T01:40:14.103Z`
- Final v2 pre-change provider snapshot: `C:\AI Fusion Labs\X AGENTS\BACKUPS\Dani Anam\dani-cara4-pre-sync-2026-08-09T18-35-36-201Z.json`
- Initial v2 attempt snapshot retained at: `C:\AI Fusion Labs\X AGENTS\BACKUPS\Dani Anam\dani-cara4-pre-sync-2026-08-09T18-29-47-684Z.json`
