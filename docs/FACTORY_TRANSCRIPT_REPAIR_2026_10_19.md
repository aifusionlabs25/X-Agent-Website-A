# Private Olivia transcript boundary repair

Authorized scope: trace retained session `95128029-3fc9-468e-8a12-fff8d53f6072`,
repair the confirmed host contract mismatch and run one end-to-end retest.
No persona, image, voice, prompt, knowledge, email or Production changes.

The installed Anam JS SDK 4.20.0 `MessageHistoryClient` treats user stream
events as whole messages, while persona text is accumulated. Its history event
is emitted after a speech-end event. The old host separately whitelisted every
message ID only when its own endOfSpeech was true. Consequently a complete user
message without that flag was discarded even when included in assembled history.
An offline replay through the actual installed SDK reproduces that loss.

The page also rendered only persisted finalized turns. It therefore hid persona
streaming text until completion, even though audio/video can be playing. Rob
independently confirms he saw and heard Olivia in the failed test. No raw event
capture exists for that historical run, so we do not claim to prove which exact
completion markers were historically delivered or absent.

The host now retains whole user events immediately, deduplicates them against
assembled SDK history, and displays incremental persona text explicitly as
unfinalized. Persona persistence still requires its speech-end marker and the
SDK's assembled history; no last-fragment or timeout-based finalization is used.
Original finalized evidence remains immutable, with provider reconciliation and
exact visitor-span owner mapping unchanged. Bounded diagnostic metadata records
event ID, role, length and terminal marker in the page, without credentials or
transcript content. It is not proof of acoustic delivery or model consumption.

Focused provider-free verification: 16 tests pass, including actual SDK replay,
unfinalized-fragment isolation, empty terminal chunks, duplicate/immutability
checks, owner mapping/approval, corrections, storage and close gates. TypeScript
passes. ESLint has zero errors and the existing hydration dependency warning.
The first new test invocation had a Windows file-URL decoding error; corrected
in the test import before the passing run. No model was called by these checks.

Live results and immutable identity/preservation captures are retained separately
under Factory `verification/delivery-live-qa-v0.1/20261019-olivia-transcript-retest/`.
Only the protected `codex/factory-aiowa-pilot` Preview may be deployed for this test.
