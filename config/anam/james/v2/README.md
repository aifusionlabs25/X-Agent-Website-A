# James Anam v2 — Release Notes

## Current state

This is a prepared, isolated candidate—not a production release. The original James persona and the earlier Cara 4 canary remain unchanged. Candidate persona `1663b021-60fb-4782-be63-8ed366dea747` uses the original avatar, voice, and LLM; its James-only knowledge group is `eae271e8-9d73-4cfd-8a46-6463f893aed3`, served by tool `5796aee6-6963-4b0e-a378-28517a631461`. All six documents were read back from Anam as `READY` on 2026-09-23.

The account readback reported provider-side zero-data-retention disabled. The website release gate is therefore closed. The user approved either verified provider zero-retention or documented privacy approval for retained transcripts as a hard release condition; that approval/evidence has not yet been supplied. Do not mark `privacyGate` approved or `deploymentStatus` published without the matching evidence and completed smoke checks. The site token route and James page fail closed while the gate is closed, and the transcript route suppresses James transcripts before storage, analysis, export, or email.

## Contents

- `system-prompt.md` is the James-only Anam system prompt.
- `knowledge/` is a six-document, public-fact-only allowlist. Tavus prompts/configuration and all other agent data are explicitly excluded.
- `knowledge-manifest.json` contains canonical-LF fingerprints and Anam document IDs.
- `runtime-release-manifest.json` pins source/canary snapshots, the v2 candidate, tool and document readback, privacy evidence fields, and release checks.

## Verification

- `npm run test:anam:james` runs the James release-policy, privacy-suppression, prompt, and bundle tests.
- `node --env-file=.env.local scripts/anam/audit-james-v2-candidate.mjs` performs GET-only verification of Anam resources. It does not publish, update, delete, or share them.
- `scripts/anam/create-james-v2-candidate.mjs` is create-only and requires `--apply`; do not rerun it for this existing release because it will refuse duplicate names.

## Hermes evaluation

James is suitable for evaluating the latest X Factory Hermes approach only with synthetic legal-intake fixtures and a James-specific rubric. Do not connect real James sessions or visitor transcripts to the current Amy-only Hermes pipeline: its scrubber is not sufficient for legal narratives, and the pipeline sends text to an external model.
