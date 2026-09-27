# Isolated James hosted canary

Production base: `f22c77d99e425e64e44eda2f378c0073f48a5a9d`.
Rollback: `dpl_FeLgesC219FTstMiL9dWh7n9ya3j` / `x-agent-website-cnys0h7dd-robs-projects-e72bad73.vercel.app`.
Route: `/demo/james-vnext-canary`. Unlisted, noindex, demo only; legacy `/demo/james` and the agent directory are unchanged.

## Port/reuse map

| Local James capability | Existing hosted pattern | Decision |
|---|---|---|
| Persona/token/launch binding | Anam token route, session-api metadata/clientLabel verification | Reuse API and verification helpers; isolated endpoint, exact canary persona, no overrides |
| SQLite receipt-backed notes | Redis REST session-spine, TTL, atomic writes | Adapt to isolated encrypted Redis record with compare-and-set revisions; no SQLite/new datastore |
| Finalized microphone bridge | AnamPlayer stream events; local final-event/history join | Port final-event/history join and sequential ingestion; never grade a last fragment |
| Structured brief/corrections/contact | Local Live Notes/host extraction and field projection; hosted workbench projections | Port conservative field/atomic correction rules, contact candidate confirmation, provenance and concise projection |
| Handoff | Client tool receipts and hosted post-session finalization | Request/prepare only; no email adapter or public send control |
| Goodbye | Local visitor-intent latch and browser SDK; hosted session-api release metadata | Port intent latch, one SDK stop, server-verified release before CLOSED |

No Jordan implementation exists in this production source. Amy and Evan provide the available workbench/session patterns; no agent-specific shared code is altered.

## Boundaries

Current persona `ff9c480e-44d1-4a8c-8ae6-b5666fd2a92d` is read at launch, never updated. Owner-published voice, greeting, Knowledge and tools remain provider-owned. Inspection on 2026-09-27: prompt SHA-256 `0862ec0f274a59019a270a9769447841f5ca47903b89df376b8c2f7418085e1a`; voice Jerry B., `5ea79b27-25e5-52d9-bab8-944038935c40`.

The existing production Anam key and Redis/session-secret configuration are reused server-side. James keys, cookie and encryption domain are isolated. Records expire after 24 hours. The canary accepts synthetic demo information, not confidential legal documents. Browser-finalized evidence is provisional until matched to the provider transcript at close. Missing or mismatched provider evidence fails closed.

Public handoff is never sent or human-reviewed. `?mode=owner` grants no email authority. Local owner-send credentials/policies are deliberately not transported into the public deployment. Hosted owner email is unavailable; the existing local owner capability remains unchanged.

Rollback uses the site's established Vercel rollback to the deployment above. No persona rollback is needed: deployment does not mutate the persona.

## Provider-free verification

Ten focused tests pass, including a complete mocked hosted lifecycle, consent-independent no-send enforcement, encrypted storage/reload, exact provider evidence verification, email confirmation, atomic correction and late-turn protection. The 42 existing session-spine/close boundary regressions also passed. TypeScript and the normal Next.js/Turbopack build pass. No existing tracked application file changed.

The local dependency junction was replaced with a copy of already-installed dependencies for the build; no package or lockfile changed. The React lifecycle review retained one SDK cleanup path; all structured state remains server-owned. One post-deployment smoke is authorized, using the checked-in synthetic microphone harness. Its transcript and result are retained outside public assets.

## Single hosted smoke result — incomplete, not owner-ready

The one authorized hosted session on initial deployment `a8629adc6fa61942c93cd840711e29b2ead38b8e` was `1e62f776-9cb1-4784-9388-385adcbe0a64` (Anam `0c4e7f28-5323-4fbf-bd7b-c36218e3b975`). Exact persona/owner voice launch, the first visitor utterance, name capture and structured brief succeeded. The second utterance was rejected locally: contact extraction left a period, which the preceding phone-or-email question caused to be treated as an uncertain email. Atomic reconciliation preserved the prior accepted state. Cleanup used the SDK stop path, but transcript/state equality correctly prevented a false local CLOSED result because the rejected visitor utterance was present only on the provider side.

The normal implementation defect is repaired: punctuation-only contact residue is ignored, and a previous email question alone cannot classify an unrelated current correction as an uncertain email. Evidence-span validation remains unchanged. The exact retained two-turn replay and ten existing focused tests pass (11 total). No historical session is rewritten or replayed live. No second session is authorized or launched. Contact completion, unresolved-question retention, requested handoff and successful live CLOSED/reload were not established by this interrupted smoke. Do not present the hosted canary as fully qualified.

Local smoke evidence: `C:/Users/AI Fusion Labs/Documents/Codex/james-hosted-canary-evidence-20260927/smoke.ndjson`; SHA-256 `9b2bbd1eacd223812171c4ea3f7882e9a4aa01acb68b175ef1a60856771c7b12`. Real emails sent: zero. No Anam persona/config mutation occurred.
