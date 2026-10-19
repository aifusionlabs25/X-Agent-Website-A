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

## Single live retest finding

Retest provider session `05db51ef-94cc-4ba3-9e86-4f4c292010c3` captured actual
stream/history metadata: persona reply chunks, a terminal marker, and assembled
history of length 2211 arrived and persisted normally. The history contained only
persona messages, not the typed visitor turn. This demonstrates that the old
all-role end whitelist was a reproducible latent bug, not sufficient to explain
the missing typed text in this environment. The historical run's unrecorded
events are not invented retrospectively.

The actual typed path calls SDK `sendUserMessage`, which only sends a data-channel
message and does not update `MessageHistoryClient`. The UI cleared its input and
depended on an echo that the observed backend does not provide. Typed submission
now persists its exact browser evidence before one dispatch, with a local
`typed-visitor::` reference (not a claimed provider message ID). Storage failure
blocks sending. Unknown dispatch outcomes are never automatically retried.
Provider transcript matching remains mandatory before owner approval; saving
browser input is not treated as proof the provider received it.

Three additional provider-free tests prove persist-before-send, no-echo capture,
unknown-send/non-retry behavior and exit intent. Total focused checks: 19 pass;
TypeScript passes. This final typed-path correction was made after the one live
retest exposed it. No second live session was started. End-to-end approval/export
is NOT certified by this task; the retained live run stopped at the evidence gap.
