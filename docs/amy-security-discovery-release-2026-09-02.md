# Amy security discovery correction — 2026-09-02

Public entry: https://xagent.aifusionlabs.app/agents/amy

## What changed

- Keep technical explanation available, but use neutral discovery questions and leave control validation, remediation effort, dependency decisions, and scheduling to responsible owners and Insight specialists.
- Preserve visitor-reported security findings, affected scope, technical audit requirements, accountable teams, unresolved lead assignments, evidence sources, and governance context. These are reported facts, not independent validation by Amy.
- For the security replay, show separate encryption and privileged-access scope reviews followed by owner-led dependency validation. Do not imply approved parallel execution or that smaller scope means a faster fix.
- Recognize affirmative “road map” requests through finalization, including mixed display-and-email requests, without treating quotations, withdrawn requests, or email-only requests as display intent.
- Give Amy a bounded receipt of the actual rendered roadmap and one short display-confirmation sentence. Tool arguments are never evidence that requested content reached the screen.
- Retain security context in all three existing emails. When a roadmap was requested, include the final conversation-grounded roadmap inline, using the same model as the workbench. This adds no attachment workflow or delivery action.
- Preserve late-listed timing/workloads in mixed security/AI recaps and keep available data distinct from assessment evidence. Label bounded operations transcript excerpts honestly.

## Scope and verification

Only Amy's model, display receipt, prompt, email presentation, runtime prompt fingerprint, and focused tests changed. No model/voice/avatar/KB, credentials, consent, memory, session routing, recipient, provider, or other-agent changes.

- 58 Amy replay/receipt tests pass, including corrections, negations, source isolation, mixed scenarios, and live/final roadmap parity.
- All 38 email tests pass. Existing Visual Brief attachment bytes match the prior checkpoint; no new attachment claims.
- Local broader Anam suite: 403 pass, one skipped, two known Windows CRLF-sensitive Dani KB failures. The committed LF version must pass Linux CI before declaring the release ready.
- Local lint, TypeScript validation, and production build pass.
- Chrome verification used the actual workbench and generated visitor/intake/operations HTML. Visitor frames at desktop and 390px widths had no horizontal overflow; Insight logo loaded. No console errors observed. Temporary preview sends no email and starts no Anam session; removed before release.

## Release contract and rollback

Expected Amy prompt SHA-256: `ed446b9f116434dc403e6ea8695ca2fa972c318eff0c79609c61ce87a8051bfe`.

Publish website and matching Anam prompt together. The guarded updater must take an outside-repository backup, match complete persona/tool inventories and current state, and verify other personas and protected settings are unchanged. Do not bypass readiness checks.

Rollback is the prior website revision `f5035544d6fc97b1bfabde6410334f1f71ded1f7` together with its backed-up Amy prompt, SHA-256 `3cb71e32821a024811110fc3dd2256b4cad093c439839dcebb45f108ce95b151`.

## Next manual test

Ask Amy to discuss two security findings alongside a modernization objective; provide scope, team ownership, an audit target, and an unresolved decision. Request the roadmap, correct one fact, then close naturally. Check that spoken claims match the screen and that all three emails preserve the correction. Automated replay cannot guarantee live LLM behavior, ASR, audio, or inbox delivery.
