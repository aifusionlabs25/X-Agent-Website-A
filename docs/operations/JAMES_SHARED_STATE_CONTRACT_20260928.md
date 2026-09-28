# James shared intake contract — bounded hosted repair

Baseline production: `00a0fe2c0270a303e2ec2dce09c6d6794db5c004`.
Retained Anam session: `8416c2f2-91f3-426d-904f-5407566971c4`.
Its hosted session binding: `abf6e34f-d59e-4799-bf1b-34d06d472e47`.

## Reproduced before editing

The complete retained finalized provider transcript was replayed through the deployed source. Its exact visitor evidence was preserved, including ASR variants rather than silently correcting the legal wording.

- Caller-reported reason became material facts, while readiness demanded a reason field plus its own limited vocabulary check.
- Document answers were accepted as `material_facts`, `topic=paperwork`; readiness ignored that topic for paperwork.
- Any question mentioning email was treated as primary contact email, even a question about a document's date.
- `No, ...` entered correction parsing; ordinary negative answers became clarification failures.
- Question selection mixed storage field names and intent IDs; it neither recognized all completed intents nor bounded clarification attempts.
- The unverified-matter branch demanded a notice/filing/opposing-party checklist even for a general inquiry.
- Exact visitor exit `Understood. Keeping it quiet. Goodbye.` failed the whole-utterance farewell regex. Provider metadata records `CLOSED_BY_ENGINE`; offline replay remains ACTIVE. The hosted encrypted record was not available through local read-only credentials, so no claim is made that its exact final stored status was independently read.

## Repair

Canonical intent projection now joins accepted fields, context-bound answers, readiness and host guidance. Extraction records intents once; readiness does not re-parse visitor wording. Question-bound answers retain the question text/hash alongside the visitor evidence/hash. ANSWERED, EXPLICIT_NONE, UNKNOWN, DECLINED and UNANSWERED remain distinct; unknown never becomes a known fact. A failed clarification is bounded to one additional attempt, then preserved as unknown. Resolved intents cannot be selected again.

Contact-email questions are explicitly distinct from document wording/date questions. Context cannot overwrite an independently identified different field. Bare yes/no never manufactures a phone/email/name value. Filler is ignored after contextual negative-answer handling. General unverified inquiries use reason, factual context, timing, requested outcome and contact opportunity rather than mandatory specialty fields. Existing applicable criminal, injury and contractor depth checks remain.

Standalone terminal farewell clauses trigger CLOSING_PENDING even after other words. Readiness is not changed to close a session. Existing one-shot SDK close, provider transcript verification, storage encryption, and receipt checks remain authoritative and unchanged.

## Verification boundary

Focused provider-free regressions cover the retained employment trace, retained contractor state, unrelated-field protection, unseen negative/unknown answers, clarification limits, contact accuracy, correction preservation, receipt/provenance checks, and incomplete-intake exit. A single hosted session is authorized after offline checks. No prompt, voice, Knowledge, Factory, legacy James, UI, or email-transport edits; no real email authorization for this task. Live outcome is recorded separately; offline success is not owner readiness.
