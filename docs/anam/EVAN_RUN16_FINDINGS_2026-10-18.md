# Evan Qwen candidate: run 16 findings

Status: failed live release check. Candidate persona `6097c73e-b6ef-48c5-94c7-9a95d4863b99` remains on Qwen 3.6 27B; production was not changed.

## Evidence

- Tested immutable preview: `x-agent-website-ddu0ju57b-robs-projects-e72bad73.vercel.app`.
- Provider session: `023ffd75-38c2-457d-a820-7cb06ee45a4f`, October 18, 2026, 4:03 PM Phoenix, 3:07 duration.
- Human test report: `C:/Users/AI Fusion Labs/Documents/Codex/2026-10-17/so-hear-me-out-i-want/outputs/evan-live-test-results-2026-10-18-run16.md`.
- The provider transcript and tool-call receipts were retrieved independently. Rob heard dominating, repetitive speech during discovery. The transcript shows several 12–15 second agent turns but does not itself show the repeated unanswered question he observed. Discovery is therefore not cleared; the recording requires human review against the reported audio.

## Reproduced local failures

1. The exact first closing statement, “Okay, that answers it. Thank you. I'd like to end the call now. Thanks.”, returned `false` from `hasEvanCloseIntent`. The trailing thanks hid the explicit final request. The second statement, “No, I'm all set. Please end the call now.”, also returned `false`; the bounded wrap-up clause hid the final directive. Both became regression tests and now authorize closing with the same completed-turn, freshness, correlation, and continuation guards.
2. The exact route statement, “Right, yeah, well it's Gilbert in Arizona to Chandler, Arizona.”, yielded only a Chandler destination. The parser recognized “to Chandler” but not the conversational Gilbert origin. A moving-question context now permits this two-city Arizona route, while the same wording after an unrelated sightseeing question does not create pins.
3. The second rejected close produced an internal-sounding spoken line before the tool call. The client parser's refusal explains why Evan failed to close, but does not prove why the model voiced its internal reasoning. The prompt already prohibits exposing hidden reasoning. The first accepted close path needs live verification before claiming this leak is resolved.

The exact failures were reproduced before the parser changes; the focused tests pass afterward. The broad Evan release suite passes 353 checks and TypeScript passes. The repository-wide `npm test` could not complete because Amy Hermes test setup rejected the Windows operating-system temp directory (`local_output_root_unsafe`); this is unrelated to Evan's modified files.

## Next live check

Use a fresh isolated preview containing the parser repairs. In one staged conversation, check the first explicit end request, Gilbert-to-Chandler live pins, and the discovery audio against Rob's observed monologue. Include tentative fragile-kitchen packing only if the visitor actually says it. Treat any repeat, stacked question, or spoken internal instruction as a hard fail. Do not promote to production on token or unit-test evidence alone.
