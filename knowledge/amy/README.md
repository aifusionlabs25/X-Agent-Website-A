# Amy knowledge and prompt archive

This directory is the canonical in-repository snapshot of the proven Amy material previously maintained under the Insight Amy Tavus workspace.

## Contents

- kb contains the twelve knowledge files that were manually synchronized to Amy in Anam.
- system-prompt/amy-insight-sdr-20.1.txt is the full Tavus-era Amy prompt used as the comparison baseline.
- system-prompt/amy-insight-sdr-20.1a-goldilocks-notes.txt contains the later pacing and conversational notes.

Files 00 and 14 are especially relevant to the feature workflow: email and close guardrails, and workbench terminology and boundaries.

## Publishing boundary

These files are reviewed source material; committing them does not automatically change the Anam persona. The published Anam prompt and knowledge attachments remain external state. Use the scripts and upgrade files under config/anam and scripts/anam, then verify the published persona in Anam before production use.

Do not edit the archived source copies in Insight Amy as a way to change production. Make reviewed changes here first and record the Anam publication in the production runbook.

## Public-safe versioned bundle

The deployment allowlist now lives under `config/anam/amy/v1/`. It is intentionally separate from this Tavus-era archive and from every other X Agent. Its manifest and hashes must pass the focused bundle tests before any reviewed Anam sync.
