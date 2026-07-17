# James Anam Cara 4 release

Release date: 2026-07-16

## Purpose

This release moves the public James demo to a reversible Cara 4 canary with a source-controlled system prompt and knowledge bundle. The original persona remains unchanged as a rollback point.

## Safety posture

- James identifies himself as an AI intake assistant and not a lawyer.
- The supported scope is Arizona criminal defense, DUI defense, and personal injury.
- James does not give legal advice, calculate deadlines, predict outcomes, clear conflicts, accept cases, or create an attorney-client relationship.
- The demo does not submit intake data, schedule consultations, send emails, write to a CRM, or promise callbacks.
- Anam zero-data-retention is unavailable on the current account plan. The managed persona therefore reports it disabled; the application independently suppresses James transcript storage and all outbound transcript processing.
- Website transcript persistence, analysis, Google Sheets export, and email delivery are suppressed for James before any outbound processing begins.
- Returning-user memory is disabled for this legal-intake demo.

## Reversible architecture

- Source persona: `8a991c93-0c95-42c5-8c22-a67428946eb8`
- Managed persona name: `James Knowles Law Firm - Cara 4`
- Managed persona ID: `ff9c480e-44d1-4a8c-8ae6-b5666fd2a92d`
- Avatar, voice, and LLM are inherited from the source persona.
- The website points only to the managed persona after the live verification succeeds.
- The source persona and its older knowledge group are not deleted or modified.

## Release gate

The website reads the managed persona before issuing an Anam session token. It fails closed unless all of these remain true:

- persona ID matches the site configuration;
- avatar model is `cara-4`;
- the opening identifies James as AI;
- the versioned prompt markers are present;
- the versioned James knowledge tool, `skip_turn`, and `end_call` are attached.

Run `npm run test:anam:james`, `npm run build`, and `npm run anam:audit:james` when releasing or investigating configuration drift.

## Rollback

If the managed persona is unavailable or fails verification, do not bypass the release gate. Restore the live configuration, or temporarily point the website back to the source persona only after reviewing its older prompt and knowledge behavior. Keep outbound transcript processing disabled for James in either case.
