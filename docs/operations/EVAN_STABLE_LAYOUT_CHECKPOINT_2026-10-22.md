# Evan stable layout checkpoint — run 57

User accepted this layout and secondary-detail scrolling on October 22, 2026. Production publication remains explicitly unapproved.

## Recovery identity

- New stable Git ref: `codex/evan-stable-2026-10-22-run57-layout`.
- Tested application source: `dee7dc51c4ffef75af675ae71cd82d76cb8cebee`.
- This checkpoint adds deployment exclusions and evidence documentation only; no application behavior changes after the tested source.
- Previous stable ref retained: `codex/evan-stable-2026-10-22-run56` at `ac9835d6456fd330b2e3faa7bf65987acab657d4`.
- Preview: https://x-agent-website-4luzkxwja-robs-projects-e72bad73.vercel.app/demo/evan
- Deployment: `dpl_FNdDs51uRwrCNEZ7e9gaHGZDwG2P`; rehearsal environment; no aliases.
- Candidate persona: `6097c73e-b6ef-48c5-94c7-9a95d4863b99`.
- Deployment overrides: `ANAM_RECOVERY_NAMESPACE=evan-6097-candidate`, `EVAN_CAPTURE_ENABLED=true`, `EVAN_CAPTURE_ENGINE=local`, `EVAN_PUBLIC_DEMO_ENABLED=false`, `EVAN_CAPTURE_PRODUCTION_APPROVED=false` (runtime and build).

## What is accepted

- Compact viewport-bounded planner with visible Exit and footer; live updates and tabs remain functional.
- Populated Move Brief and Next Steps fit the tested 1423x592 viewport.
- Secondary details may scroll internally; the user accepted this, so it is not a release blocker.
- Local verification: 749 Evan release tests, 53 isolated browser checks, TypeScript, focused lint and optimized build passed before rehearsal deployment.
- Evaluate run 57: 100/100 PASS using the existing behavior scorecard. This is one live layout test, backed by prior three-run capture consistency baseline; it is not a guarantee for every future call.
- Live session `4f1671a1-36a0-4b7a-a897-57d6befd05e6`: six successful capture revisions; explicit caller end request; automatic return; successful finalization.
- Provider sent all three recaps; Admin and Sales received in AIFL Gmail. Visitor inbox delivery to the fictional example.com address was not verified.
- Full evaluator report: `C:/Users/AI Fusion Labs/Documents/Codex/2026-10-17/so-hear-me-out-i-want/outputs/evan-live-test-results-2026-10-22-run57-layout.md`.

## Remaining public-demo release work

1. Resolve visitor-copy routing (all three to AIFL versus visitor recap to visitor with internal copies to AIFL), then verify actual destinations in public-demo mode.
2. Clearly label the experience as a demonstration; retain approved sales-demo behavior while making clear that AIFL receives the demo lead and no actual Mullins callback/booking is arranged.
3. Verify production-specific gates, secrets, persona identity, local capture and isolated recovery namespace. Current rehearsal success does not prove production configuration. Do not alter production settings until authorized.
4. Prepare the controlled main-only release and rollback plan. Before public promotion, verify the final release artifact and controlled email receipts. No main push or production deployment is authorized by this checkpoint request.
5. Obtain explicit publish approval. Production last verified unchanged: `dpl_532oXZx47MLz9UWBmRWkzDx4dqLF`, source `eb3ce310a94acff6a98f9929f08f4a0c41f927c6`.

No changes to prompt, model, voice, knowledge, capture, email logic, routing settings, or production were made while saving this checkpoint.
