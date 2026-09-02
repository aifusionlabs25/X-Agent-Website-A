# Amy planning comparison correction — 2026-09-02

Entry: https://xagent.aifusionlabs.app/agents/amy

## Changes

- Session 79589acd is a semantic regression fixture: business drivers, data-security concern, leadership preference, delivery concern, decision requirements, and selection status are distinct facts. A request to add IT/compliance input no longer replaces earlier context. Later email and farewell turns do not erase those facts.
- A visitor asking whether cloud migration and security/compliance should be planned together gets an integrated-versus-phased decision aid. Each option shows a conditional benefit, trade-off, and validation question. Neither is an approved architecture or implementation recommendation. The comparison trigger must not hijack the separate cloud-plus-AI workshop flow.
- All three email lanes retain those separate facts. Existing visitor design, contacts, recipients, delivery providers, consent, idempotency, and attachment renderer remain unchanged.
- After a tool-driven view commits, the player includes only its latest view name and revision in the existing authenticated completion request. No transcript, HTML, contact, or model-generated facts are accepted. The completion route and store restrict metadata to Amy, validate bounds, and preserve ownership/rate-limit checks. Metadata is stored atomically with completion, including close-before-bind recovery, under the existing seven-day record TTL.
- Final email content is still rebuilt from the authoritative provider transcript. The displayed selection restores the existing `amy-visual-brief.html` export when the visitor accepted a visual offer without saying its name. It is a finalized working brief, not a screenshot of a particular live revision. This is not a new file-generation workflow or a guarantee that every historical/manual view is exported.
- Two small prompt edits answer the actual decision question with business trade-offs and eliminate the spoken pre-tool update preamble. Net prompt growth is five words. No LLM, voice, avatar, KB, memory, audio, credential, or other-agent persona changes.

## Verification

- 71 Amy regression tests and 38 all-agent email tests pass locally. Coverage includes the actual completion handler, same-origin/cookie checks, cross-browser and cross-agent rejection, invalid content rejection, bounded metadata, close-before-bind preservation, mocked final three-email dispatch, duplicate prevention, negations, corrections, and cloud/AI non-regression.
- Broader local Anam suite: 403 pass, one skip, two pre-existing Windows line-ending-sensitive Dani KB failures. Linux CI must confirm the committed LF source before release is declared ready; Dani's files are unchanged.
- Scoped lint, TypeScript, and production build pass. Local build uses a temporary Turbopack root for the dependency junction, removed before commit.
- Chrome: actual comparison slides and generated email/export HTML rendered; desktop visitor width 661/661 and mobile 370/370 client/scroll pixels (no horizontal overflow); Insight logo loaded; no console errors. Temporary local preview and its generated validator were removed. No live emails or voice session were sent by this test.

## Publish and rollback

Expected prompt SHA-256: `af9a25615b2de9b35a2f885530c3a26b3ca0b2d219794deb572050033b0ff17a`.

Publish the website and matching Amy prompt using the guarded updater with fresh state/inventory hashes and an outside-repository backup. Verify other personas, shared tools, protected settings, and KB remain unchanged. Do not bypass the runtime release contract.

Rollback pair: website commit `0cd3092d072fe4c46545cf3455757e519b1e1ec2` and prior prompt SHA-256 `ed446b9f116434dc403e6ea8695ca2fa972c318eff0c79609c61ce87a8051bfe` from the guarded backup.

## Next live test

Ask about planning cloud migration and cybersecurity compliance together or separately. State business drivers and a leadership preference; accept Amy's visual offer with only "Yes, that would help." Add the IT/compliance-input requirement, inspect the update, then close naturally. Confirm both options are visible and all three emails preserve earlier facts plus the new requirement; visitor and intake should include the existing Visual Brief HTML attachment. Live speech, ASR, tool invocation, and inbox delivery still require this manual test.
