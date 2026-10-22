# Evan run-53 name and fragile-dishes capture repair — 2026-10-22

## Scope

User authorized missing-name and fragile-dishes capture fixes, varied local transcripts, and a verified rehearsal handoff. Production and unrelated behavior remain unchanged. No persona, prompt, model, voice, tool, audio-routing, email-routing, date, or property-rule changes. Local deterministic capture stays enabled; the cloud extractor stays off.

## Findings and repairs

- The exact run-53 contact answer was present in the transcript but lacked a name in the captured record. Evan's final question, "What name and number should I give them?", lost the immediately preceding "I'll need your name" context. Generic contact-handoff questions now retain that adjacent statement, without borrowing older questions or unrelated topics. Other people's contact details remain excluded.
- Names supplied alongside phone and email survive conversational prefixes, including "Sure! Um...". "Yes, that's exactly right" remains an acknowledgment, not a new identity. No name is derived from Evan's readback or an email address.
- "I do have some fragile dishes" and "We do have..." now take the same inventory path as ordinary possession. A subsequent packing-price question remains a question, not an approved service request.
- Conditional/reported possession stays out of the caller's inventory. A later "I do not have any fragile dishes" removes the existing item rather than leaving it active under a different descriptor.
- A plain fragile-item declaration contributes fragility to the care notes, while quantity remains with its inventory item. Correcting the quantity no longer leaves the old count duplicated in care/email text. Additional explicit handling details remain intact.

## Verification

- **40/40 new run-53 regressions pass**, including the exact reported dialogue, bundled/split contact answers, punctuation, corrections, acknowledgments, third-party/conditional exclusions, dishes quantities/removals, and service questions.
- Cases exercise actual capture, schema/evidence validation, live and final contact, planner projection, and all three email bodies. Network access is blocked in the test fixture.
- Independent test review reran **40 run-53 + 30 run-52 cases**, all passing. Prior endpoint properties, pickup/delivery access, numeric date, and phone-confirmation checks remain intact.
- A second read-only reviewer independently passed all 40 cases plus 13 bounded local probes, with no actionable in-scope blocker. These probes covered context ownership, reported/conditional possession, emphatic wording, negation, and quantity corrections.
- Evan release suite: **744 passed** (403 + 341), zero failures.
- Broad repository suite: **599 passed**, one opt-in provider test skipped, zero failures. Initial sandbox-only Windows temp-directory errors cleared on the normal-access rerun; no product code was changed for those errors.
- TypeScript, changed-file ESLint, and optimized local build pass. Logs: `work/evan-6097-promotion/run53-{release,broad,build}.log`.
- These are local capture and integration results, not a claim of universal accuracy or a live-call pass. Run 53 remains NOT PASS (80/100); the new candidate starts at **0/3** consistency passes.

## Provenance and deployment boundary

- Candidate branch: `codex/evan-6097-promotion`, base HEAD `bab6d71be29875f886afcc9cb62a50c2591e54bb`; all prior uncommitted candidate work preserved.
- Current repair runtime files: `lib/anam/evan-contact-identity.ts`, `lib/anam/evan-deterministic-capture.ts`.
- Contact source SHA-256: `b069f947e8fcc2d04629bf66deff93ce98b16dc5f76c6fa23e621faedd8e8a84`.
- Capture source SHA-256: `ac1cec830849f6a4749effe896c5169c666f01ba7584ff8c20929dd596566815`.
- New test: `tests/evan-capture-run53.test.mjs`; SHA-256 `91a68a77ad29432fdd4b66d5f57412294372e01c4da65da13192806cb63ce992`.
- Target: existing preview-type `amy-ceo-rehearsal` custom environment, project `prj_bV8rj56Sxm9BnNSgTxp5DcHrPVvs`, deployment without domain assignment.
- Production baseline: `dpl_532oXZx47MLz9UWBmRWkzDx4dqLF`.
- Shared rehearsal baseline: `dpl_GcRLN42T3eMZfRNFpcQFLP42bXyq`.
- Verify READY, empty aliases, both entry paths, and capture enabled before sending Evaluate the protected share link. Entry smoke checks must not start an engine call or send an email.

## Verified rehearsal handoff

- Deployment `dpl_CfcDhN5mEhbnsgVPV1LchGELUH62`: **READY**, `alias: []`; remote build approximately 47 seconds, Next.js.
- Immutable URL: https://x-agent-website-2sijvsy43-robs-projects-e72bad73.vercel.app/demo/evan (protected; use the share link sent directly to Evaluate/Rob).
- Both guest and synthetic-email entry pass through cookie round trip, candidate session-token issuance, and logout. Capture enabled is verified in both lanes. Two short-lived launch reservations created; no engine/live call/email started.
- Production and shared rehearsal aliases rechecked after deployment: both still match their baseline IDs above.
- Ready for focused live retest, not production approval. Evaluate receives this exact build as the replacement for the run-53 `m56umlluq` preview, with the existing practical scorecard and 0/3 consistency passes.
- Evaluate must wait for Rob's go-ahead before starting, verify name supplied with phone/email plus fragile dishes in live notes and all three email projections, and check that prior property/access/date/contact-confirmation behavior holds. No audio/profile changes.
