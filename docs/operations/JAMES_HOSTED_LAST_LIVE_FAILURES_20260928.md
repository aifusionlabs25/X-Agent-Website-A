# Hosted James — bounded last-live-failures patch

Baseline: `758baf3bad559e47e8c7804a5c789db5d5fb2bad`.
Only the existing James canary changes. Published Anam prompt, voice, Knowledge,
legacy James, Factory and page layout are unchanged.

## Retained diagnosis

Owner Anam session `4d4c9a2f-24fe-4a73-8d4c-fef1149f7596` failed on contact
ingestion: removing the name from a compound clause left a fabricated, noncontiguous
evidence span. The source-span guard correctly rejected it. The browser then
failed closed on subsequent finalized turns; this prevented the later handoff and
goodbye from reaching local state. The visitor's `Bye.` was already recognized.

Original transcript SHA-256:
`39eb0f5fda85211823181837b3480dcd4f4f1ce49cf7ce2e0def0782cfa3ff3a`.
Read-only offline replay after the patch ingests all 14 visitor turns, retains
the refund outcome and urgency, and records HANDOFF_REQUESTED. Original evidence
is unchanged in `Documents/Codex/james-hosted-last-failures-20260928`.

## Narrow changes

- Discard only filler left around exact contact spans. Disconnected substantive
  residue retains its original clause as uncertainty; grounding is not weakened.
- Recognize refund/recovery outcomes; expose completed intent and source-bound
  semantic memory to the existing handoff tool.
- Contractor-specific factual depth, literal dates and CLIENT_REPORTED_URGENCY;
  civil practice scope remains explicitly unverified.
- Unanswered email remains OPEN. One next question cannot authorize completion.
- Contextual `Yes, please` can accept an actual summary offer. Callback timing
  never supplies handoff consent.
- Canonical phone stays in state; tool readbacks use digit words only.
- Existing end intent, exactly-once SDK stop and provider transcript verification
  remain authoritative. Fix ingestion, not farewell wording.
- Owner-test email uses the existing AgentMail transport, a signed two-hour
  capability, one-use Redis grant, fixed recipient `aifusionlabs@gmail.com`, and
  a durable reservation before the one transport attempt. Public `mode=owner`
  alone is never authorization. No retry; SENT requires provider receipt.

## Offline verification

32 focused tests pass, including full mock owner HTTP lifecycle, one-use launch,
PREPARED/CLOSED requirements, durable send reservation, failure/no-retry and
reload. TypeScript check passes. Existing unrelated component lint findings
(home navigation anchor and stale eslint-disable) were not changed.

Live qualification is separate: at most one hosted session and one real email,
only after protected email preflight succeeds. No live pass is claimed here.
