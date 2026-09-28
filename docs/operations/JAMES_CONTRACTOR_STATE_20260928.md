# James hosted contractor state / conversation continuity

Baseline: `cbba02b5f2402c3b41578e2e18e66ba2747894bc`.

## Confirmed retained failure

Session `8b5f52c8-ca6c-4318-8da5-8bf2f8cdc012` / Anam
`24b09ac0-b0af-4f15-a061-d525cb71758d` retained the contractor communication,
but classified it as a desired outcome. `questionIntent` gave the word “refund”
priority over a historical communication question. Readiness excluded outcome
facts and re-matched selected phrases, so it reported contractor contact missing.
The complete retained stream SHA-256 is
`1ef177740618bff309deeca842290d3853a71e874112e6d109f99e12fee3c37e`.

## Bounded repair

The existing source-bound fact store now has a `contractor_contact` field with
a reported communication act: contact, refund request, non-response, explanation,
or explicitly not contacted. Actor/context, reported tense and negation distinguish
those acts from desired remedies and future contact. Exact visitor evidence and
hashes remain required. Readiness consumes the typed current field or a contextual
explicit unknown; it does not re-match the raw contact wording. Completed intent
and evidence are returned to the existing state tool, with no repeated contact
question once resolved.

The live second greeting bypassed STATUS; the old prompt's opening instruction
was not explicitly start-only. Two prompt paragraphs now restrict greeting to a
new session and require continuity after contact details/corrections/tool results.
The tool also returns `greeting_allowed` and the ongoing-intake instruction.

Published prompt before:
`0862ec0f274a59019a270a9769447841f5ca47903b89df376b8c2f7418085e1a`

Published prompt after:
`22256e741fb60f8548efdf22200024f145c5f32703460331d4bbf711443404ce`

Readback matched. Jerry B, avatar, Knowledge tool/binding, handoff tool, director
settings and other stable persona settings are unchanged. Expiring signed media
URL query credentials are not configuration drift. Rollback/readback snapshots
are retained in `Documents/Codex/james-semantic-state-20260928`.

The new owner-authorized single verification receives a new one-use grant under
the SAME email policy. Recipient, sender configuration, transport, no-retry rule,
reservation and receipt requirements are unchanged. No public send allowance is
created. The previous consumed grant and session remain unchanged.

## Provider-free result

Exact retained replay: before INTAKE_INCOMPLETE; after HANDOFF_READY, requested
refund preserved, two typed communication facts, HANDOFF_REQUESTED unchanged.
38 focused checks pass, including communication paraphrases, future-vs-past
distinction, unrelated-party exclusion, typed readiness, continuity and reload.
Historical evidence bytes are unchanged. This is not a live qualification claim.
