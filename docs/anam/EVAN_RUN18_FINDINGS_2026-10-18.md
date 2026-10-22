# Evan Qwen candidate: run 18 findings

Status: **not ready for promotion**. The run-17 discovery failure did not recur in one call, but the live planner attached a delivery access fact to the pickup.

Source report: `C:/Users/AI Fusion Labs/Documents/Codex/2026-10-17/so-hear-me-out-i-want/outputs/evan-live-test-results-2026-10-18-run18.md`. Test preview: `x-agent-website-15qm5krgf-robs-projects-e72bad73.vercel.app`. Provider session: `5bac688f-3a51-4020-87dc-0bdcf837e05d`.

## Observations

- In this one call Evan asked one question at a time, did not speak internal process text, did not need a rescue prompt, and closed on the first explicit end request. This does not prove the intermittent discovery failure is gone.
- The caller described one flight of stairs at pickup and ground-floor delivery in a single sentence. The live Move Brief incorrectly displayed ground floor under origin while showing generic stairs.
- Tentative help packing fragile kitchen items was discussed, but its possible status was not visible in the later Move Brief check. Evan's spoken reply sounded more definite than the caller's request.
- In guest mode Evan offered to set up an email recap, although no address or recap reservation existed. No email was sent.

## Candidate repair

The planner now separates endpoint clauses even when the access fact comes before "delivery" or "pickup," and it records origin stairs rather than a wrong origin floor. Tentative packing with self-packing for the remainder stays possible, not confirmed. The prompt forbids offering to create a recap by voice after private website check-in and keeps possible packing tentative. Regression tests use the exact customer wording from the provider transcript.

The new isolated rehearsal preview passed guest and synthetic-email entry checks. No live audio test has yet established that the repairs hold in conversation. Keep production unchanged and run a scoped retest before any promotion decision.
