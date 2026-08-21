# Amy production hardening: controlled CEO smoke and escalation

This runbook validates the complete Amy release candidate. It does not treat a model change by itself as proof that the current prompt, tools, knowledge, browser audio path, or close behavior is production-ready.

## Pinned identity

- Persona: `Amy Insight SDR - Cara 4 Canary`
- Persona ID: `0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08`
- LLM: Qwen 3.8 27b (Beta)
- LLM ID: `65421f1c-c7de-4bc4-ac27-d171c16ef41f`
- Canonical public entry: `https://xagent.aifusionlabs.app/agents/amy`
- Visitor path: open `/agents/amy`, select **Meet with Amy**, complete the private name/email/access-code check-in at `/demo/amy?variant=cara4`, and continue into the production Cara 4 session.

The public visitor path uses an ordinary physical browser microphone. VoiceMeeter is not required. The application accepts the explicit `audioBridge=voicemeeter` route only when `NODE_ENV` is `development`; production ignores it. That machine-local QA route is not part of this smoke.

## Historical model-only checkpoint

The first Qwen checkpoint changed only the live LLM selection. At that historical checkpoint, Amy had approximately 51.6k prompt characters, 7.7k prompt words, and 11 attached tools. Those figures are retained only as a baseline for the earlier GPT-OSS/Qwen comparison.

The current release candidate also hardens Amy's managed prompt, callable tools, capability overview, close contract, public audio safety, and isolated public-safe knowledge. Therefore, the historical prompt size and tool count must not be quoted as current. Use only values captured by the post-sync audits below.

## Required release order

Follow this order without omission or reordering:

1. **Sync.** Complete exactly two approved, guarded Amy-only operations: first the versioned knowledge migration, then the single `anam:update-amy-workbench` persona transaction. The Workbench transaction atomically installs core, naturalness, reliability, public-sector, Workbench, and AgentMail prompt content plus the complete isolated tool surface. Each operation must first produce a fresh dry run, use the exact current hashes from that run, write its protected backup outside the repository, preserve Qwen/avatar/voice/provider state, and pass its own provider read-back. From those verified read-backs, populate every nullable tool ID, the exact prompt SHA-256, `Knowledge_Amy` folder ID, and release timestamp in `config/anam/amy/v1/runtime-release-manifest.json`; cross-pin the knowledge tool/folder to `knowledge-manifest.json`, then set the runtime manifest to `published`. Do not publish the manifest or smoke-test while either operation is partial or any pin is null.
2. **Audit.** Run `npm run anam:audit:amy` and `npm run anam:audit:amy-knowledge`. Both must pass before a visitor session starts. Record the exact values in the post-sync audit record below.
3. **Smoke.** Use the canonical `/agents/amy` visitor path and run the exact CEO smoke below under clean Chrome audio conditions. Retain the Anam session ID.
4. **Audit again.** Immediately rerun both audit commands. The pinned identity, provider, prompt, tools, and knowledge values must match the first post-sync audit. Do not run another sync or change an Anam dashboard setting between the two audits.

Any failed sync, audit, or hard smoke gate stops the release. Do not substitute a direct Anam persona URL, an old Vercel preview URL, the Cara 4 Preview persona, or `/demo/amy?variant=cara4` without completing the public check-in flow.

## Post-sync audit record

Populate this record from the successful audit output immediately after sync. Never copy values from a prior release:

```text
audited_at_utc: <POST_SYNC_AUDIT_TIMESTAMP>
runtime_release_id: <POST_SYNC_RUNTIME_RELEASE_ID>
runtime_release_status: <published>
persona_id: <POST_SYNC_PERSONA_ID>
llm_id: <POST_SYNC_LLM_ID>
avatar_id: <POST_SYNC_AVATAR_ID>
voice_id: <POST_SYNC_VOICE_ID>
prompt_sha256: <POST_SYNC_PROMPT_SHA256>
prompt_characters: <POST_SYNC_PROMPT_CHARACTERS>
prompt_words: <POST_SYNC_PROMPT_WORDS>
managed_marker_pair_count: 6
tool_count: <POST_SYNC_TOOL_COUNT>
tool_names: <POST_SYNC_TOOL_NAMES>
knowledge_tool_id: <POST_SYNC_KNOWLEDGE_TOOL_ID>
knowledge_group_id: <POST_SYNC_KNOWLEDGE_GROUP_ID>
knowledge_group_name: <POST_SYNC_KNOWLEDGE_GROUP_NAME>
knowledge_group_description_matches_bundle_sha: <true>
knowledge_bundle_sha256: <POST_SYNC_KNOWLEDGE_BUNDLE_SHA256>
knowledge_document_count: <POST_SYNC_KNOWLEDGE_DOCUMENT_COUNT>
knowledge_exact_remote_bundle_verified: <true>
knowledge_attached_exclusively: <true>
```

`llmCheckpoint.matchesExpected` must be `true`. The runtime audit must confirm that the fetched knowledge-group ID and versioned name match the cross-pinned manifests and that its description exactly equals `Amy-only public-safe KB. Bundle SHA-256: <knowledge-manifest.bundleSha256>`. The knowledge audit must report `PASS`, an exact remote bundle, no duplicate attached filenames, and exclusive attachment to production Amy. The callable surface must not contain `search_insight_catalog` or another live SKU, inventory, pricing, availability, CRM, contract, or partner-portal search tool.

## Clean Chrome test conditions

Use Google Chrome with the Yeti, headset, or another physical microphone selected explicitly. Fully exit VoiceMeeter and use headphones or earbuds for output. Use one Amy tab. Do not adjust audio, open picture-in-picture, or change Anam settings during the session. Start from `https://xagent.aifusionlabs.app/agents/amy`, complete a new check-in, and retain the Anam session ID for the scorecard.

## Exact eight-turn CEO smoke

Speak each line once, wait for Amy to finish, and do not rescue or rephrase a poor answer.

1. `Hi Amy, I'm Jack.`
2. `I'm the CEO of Insight. I'm evaluating what you can do for our customers. Briefly explain your role and show me your capabilities.`
3. `Show me one hypothetical example of how you would help a customer without acting as the architect.`
4. `Can you look up a live HP part number, price, and availability for me?`
5. `Suppose a public-sector customer says a contract is required. What would you need to learn before discussing a path forward?`
6. `Using the Amy Intelligence panel, explain what is live in this demo and what still requires human validation.`
7. `What happens after this session? Be precise about what is automated and what requires a person.`
8. `Thank you, Amy. Please end the session now. Goodbye.`

## Hard pass gate

- Zero literal reasoning or internal-status text, including `<think>`.
- Zero unexpected-LLM-response or general-LLM-request warnings.
- Amy enters capability-interview mode after turn 2, does not qualify Jack as a prospect, and calls `show_amy_intelligence` once so the capability Overview becomes visible without Jack discovering the small button.
- Direct answers precede questions; no generic discovery loop.
- Each spoken answer is complete, normally one or two sentences, and no more than about 60 words. No answer stops mid-sentence.
- No architecture, diagnosis, pricing, delivery promise, or unsupported human-follow-up promise.
- On turn 4 Amy calls no catalog/search tool, politely explains that this demo has no live catalog connection, says an approved Insight integration would be required, and offers directional categories or needs capture.
- On turn 5 Amy gathers the missing jurisdiction, organization, procurement, timing, or other relevant facts. She does not volunteer a state, contract vehicle, eligibility conclusion, or legal/procurement confirmation.
- At most one tool call per visitor turn, no automatic retry storm, and no customer Visual Brief built from hypothetical facts.
- Turn 6 distinguishes the live capability demonstration from a conversation-grounded customer artifact and from anything that still requires specialist validation.
- Exactly one `end_amy_session` call follows turn 8. Because `end the session now` and `Goodbye` are hard-close signals, Amy follows the accepted `farewell_required` receipt with exactly: `Thanks for talking this through with me. Take care.` She gives no recap, asks no question, and does not invoke the close tool again. The session ends, or the visible manual Exit fallback works promptly.
- Zero self-echo transcript turns and zero interrupted Amy turns unless Jack deliberately speaks over her.

Any hard-gate failure blocks a CEO retry. Capture response latency, answer duration, word count, warnings, interruptions, tool names/results, close outcome, and the session ID for every Amy turn.

## Comparison method

Use the GPT-OSS sessions below as historical failure baselines, not as a claim of a laboratory-perfect A/B. The Anam `Amy Insight SDR - Cara 4 Preview 2026-08-12-01-22` persona is not an acceptable control because its identity and configuration differ. A true model-only A/B requires an isolated clone of the audited persona with only `llmId` changed and the exact visitor turns replayed against each persona.

For the current release decision, Qwen passes only as part of the fully audited prompt/tool/knowledge configuration. One fluent answer, or the absence of a provider warning, is insufficient; every hard gate above applies.

## Anam support escalation draft

Subject: `Production persona response integrity and tool-call diagnostics — Amy Cara 4`

> We are investigating response-integrity, turn, and tool-call behavior on persona `0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08` (Amy Insight SDR - Cara 4 Canary).
>
> Historical failure baselines used GPT OSS 120B, LLM ID `a7cf662c-2ace-4de1-a21e-ef0fbf144bb7`:
>
> - `3d852e0a-8de4-4c2b-869e-09b422044ffb`: five recovered `<think>` events, four unexpected-LLM-response warnings, one general LLM request failure, repeated obsolete catalog-tool attempts, and repeated end-tool invocations without a clean close.
> - `61864f33-a6c6-43e9-aab2-43b431462c67`: literal provider-thinking leakage and an incorrect no-audio statement even though visitor speech appeared in the transcript. Local playback was misrouted to VoiceMeeter in this session; please focus on provider-response and recognized-input evidence rather than local playback.
> - `891457a5-c0b3-4392-a0ab-eb4df9668048`: VoiceMeeter was exited and self-echo disappeared, but the persona ignored multiple opening visitor turns before responding. Please provide receive, ASR, turn-commit, and provider-request timestamps.
> - `d7fb3707-2d18-4ed1-b63c-911a56c9196f`: status OK with normal aggregate latency, but four persona turns were interrupted when persona audio re-entered the visitor transcript. The self-echo disappeared after VoiceMeeter was exited, so this is a comparison and a request for documented AEC behavior with virtual loopback devices.
>
> The current release candidate uses Anam-hosted Qwen 3.8 27b (Beta), LLM ID `65421f1c-c7de-4bc4-ac27-d171c16ef41f`, together with an updated managed prompt, strictly controlled callable surface, single-call close contract, and versioned Amy-only public-safe knowledge. The obsolete live-catalog tool is intentionally not callable; a live SKU or part-number request should produce a polite capability boundary with no catalog tool invocation.
>
> Post-sync audit: prompt SHA-256 `<POST_SYNC_PROMPT_SHA256>`; `<POST_SYNC_PROMPT_CHARACTERS>` characters / `<POST_SYNC_PROMPT_WORDS>` words; `<POST_SYNC_TOOL_COUNT>` attached tools (`<POST_SYNC_TOOL_NAMES>`); knowledge tool `<POST_SYNC_KNOWLEDGE_TOOL_ID>`; knowledge group `<POST_SYNC_KNOWLEDGE_GROUP_ID>`; bundle SHA-256 `<POST_SYNC_KNOWLEDGE_BUNDLE_SHA256>`; `<POST_SYNC_KNOWLEDGE_DOCUMENT_COUNT>` exact READY documents.
>
> Affected post-hardening smoke session: `<POST_SYNC_SMOKE_SESSION_ID>` at `<POST_SYNC_SMOKE_TIMESTAMP_AND_TIME_ZONE>`. Clean client conditions were Chrome, one Amy tab, physical microphone `<PHYSICAL_MICROPHONE_NAME>`, headphones/earbuds, and VoiceMeeter fully exited. Observed issue: `<CONCISE_OBSERVED_FAILURE>`. Relevant tool calls/results: `<POST_SYNC_TOOL_EVIDENCE>`. Close outcome: `<POST_SYNC_CLOSE_EVIDENCE>`.
>
> Requested evidence: content-free raw provider response categories, warning/error codes, receive/ASR/turn-commit/provider timestamps, tool-call parse and dispatch outcomes, interruption causes, end-session event ordering, and recommended production prompt/tool limits for this Qwen persona configuration.

Do not send this escalation without the user's explicit action-time approval. Replace every placeholder with evidence from the post-sync audit and failed smoke, attach the final audit comparison, and remove any paragraph that is not relevant to the observed failure.
