# Evan public-duration rehearsal: incomplete live verification

Status: **conversation failed to progress; testing held; not approved for publication**.

## Scope and identity

- Preview: `https://x-agent-website-nqyf854rc-robs-projects-e72bad73.vercel.app/demo/evan`
- Deployed application: `397b330`, deployment `dpl_6H5E1sgv5bGAJgFu13bE8bZfGtqZ`.
- Provider session: `111492d0-326e-4171-bd2a-6c0edc6c9f19`.
- Public provider copy: `3720fcf6-f9fd-4b7c-b384-af559d0c84b2`; configured cap 180 seconds.
- User confirmed entering without email and manually ending the call because Evan was unresponsive. This supersedes the evaluator's tentative recap-button/early-disconnect interpretation.
- No retry, protected call, code/configuration change, or production action was performed during this diagnostic.

## What happened

The provider allocated the session at 21:25:36.706 UTC and ended it at 21:26:58.000 UTC. Its reported duration is 81.341 seconds. The evaluator's browser connection timestamp was 21:25:47.950 UTC; its completion acknowledgment was 21:27:01.313 UTC. These measure different events and are not interchangeable cutoff timings. The provider's `CLOSED_BY_ENGINE` label does not override the user's manual-stop account. The application's completion reason was `unmount`, not `demo_time_limit`.

The complete official transcript contains 13 messages: the greeting, seven caller messages and five further Evan messages. Caller speech included repeated requests for moving help and a Mesa, Arizona to Tempe, Arizona route. It contained no customer name, phone, email, moving date, property sizes or inventory.

Evan's five post-greeting outputs were:

| Output | Provider turn result |
| --- | --- |
| Absolutely, | Interrupted while speaking |
| Absolutely | Completed, not interrupted |
| Sure, I'm here to help | Completed, not interrupted |
| Great, | Interrupted while speaking |
| Mesa to Tempe | Completed, not interrupted |

The final caller acknowledgments were recognized without recorded LLM output; the last overlaps shutdown. There were zero tool calls and zero provider-reported warnings/errors. Average first-audio latency was 1.578 seconds. Very short generation intervals are recorded but do not establish the cause.

This supports a genuine response/nonprogression failure despite recognized caller speech. Interruptions affected two turns but do not explain the three completed fragments. There is no evidence of a stuck knowledge, planner, or closing tool. The evidence does not yet distinguish model output from provider streaming/response handling, and it does not independently prove what audio was audible to the user.

## Configuration check

- Managed prompt matches the frozen Run57 checkpoint hash `39ec515166edc8a88c305ba1e0274eb416e0aae3494e46101a298439bd5e0c2b`.
- Runtime model: `qwen/qwen3.6-27b`, provider `groq_openai`, max tokens 4096, temperature 0.7, reasoning effort `none`.
- Greeting and the compared persona response/voice settings match the checkpoint. No explicit stop fields were exposed.
- A subsequent comparison with the actual accepted Run57 session (`4f1671a1-36a0-4b7a-a897-57d6befd05e6`), rather than only the saved persona, found identical full prompt, model parameters, endpoint, voice/model and actual STT/VAD settings. Both runtime sessions used `cartesia_ink_2`; it is not a demonstrated configuration change.
- The inspected engine version changed from `5.36.0` in Run57 to `5.42.0` in the failed call. This is an investigation lead, not proof of an engine regression.

## Independent response-path review

- The duration-related browser diff has no first-sentence stop. Its deadline was not reached in this manually ended call. Evan bypasses the Amy-only output interruption guard; Evan's own refused-close interruption requires a rejected closing tool, and this session had no tool calls.
- Installed SDK 4.20.0 forwards speech-text chunks and concatenates message history without cancelling speech at text boundaries. An offline test through its actual message-history implementation preserved three consecutive utterances. Continuous media playback is separate from these transcript events. This does not by itself prove compatibility with every provider protocol change.
- All 77 focused closing, recovery, duration and transcript-accumulator checks passed. These checks exclude specific local regressions; they do not establish healthy provider responses.
- The existing watchdog intentionally does not recover ordinary completed acknowledgments such as "Absolutely". This explains the lack of recovery, not why those incomplete responses were generated.
- Public provider analytics does not expose upstream `finish_reason`, raw SSE chunks, token usage or engine cancellation details. Its turn-level `completed` label cannot distinguish genuinely short model output from provider stream termination or filtering.
- The owner approved up to two isolated text-only diagnostics, each capped at 60 seconds, using rehearsal-derived configuration with no microphone, Nova, website/email integration or production changes. These are not authorization to resume Evaluate's live calls. Results must be recorded separately before any repair is claimed.

## Notes and emails

- Deployment logs show six successful capture revisions, ending with 12 source turns and four facts. This proves live extraction requests ran, not durable note storage or completeness.
- Background finalization completed. Logs explicitly record `email_not_requested`, `sent: false`, and a final transcript available. A targeted search of AIFL Gmail found no matching messages on November 13.
- The audited guest/no-email path keeps live capture in browser memory. Its persistent completion receipt contains transcript count/hash, not a saved move brief. Final brief generation happens only after an eligible recap or callback lead is established. Thus this attempt cannot prove final saved-note correctness or three-email delivery.
- Direct Redis record inspection was unavailable because the local environment lacks the required store credentials. Do not substitute lifecycle log success for a content readback.

## Test disposition

| Requirement | Disposition |
| --- | --- |
| Public three-minute cutoff | Not tested: user manually stopped earlier |
| Final saved notes | Not verified; guest path has no durable move-brief content store |
| Recap, Sales and Admin messages arriving at AIFL | Not exercised: no eligible email request in this call |
| Protected conversation beyond three minutes | Not started; held pending this diagnostic |

Next investigation should isolate the provider response path without changing capture, closing, email delivery, audio routing, or production. The evaluator must confirm actual browser/caller readiness before reporting a test underway. Any further paid/live reproduction requires a deliberately scoped next step; do not automatically retry this failed cycle.

Evidence sources: Anam session metadata, complete transcript and per-turn analytics; Vercel runtime logs for the exact deployment between 21:24 and 21:29 UTC; read-only AIFL Gmail search; code audit of capture, session receipt/finalizer and Evan email eligibility. No settings were changed.

## Authorized isolated diagnostic 1

- Session: `d39ee234-95de-49d0-9c19-5ba60c011683`; provider duration 41.950 seconds; provider cap 60 seconds. One engine start, no retries, explicit stop accepted. Local browser cleanup completed at 43.626 seconds from the diagnostic's pre-token budget start.
- Bare SDK 4.20.0, typed fictional input only. Microphone request count zero, audio playback muted, browser errors zero, blocked requests zero, interruptions zero and tool calls zero. No website, capture, closing or email code loaded.
- Derived ephemeral configuration from the fixed rehearsal copy, without modifying any saved persona. The provider runtime matched the failed call's full prompt, complete tools definitions, Qwen/Groq model configuration, engine 5.42.0, voice/TTS settings, avatar, VAD/STT, greeting and language. Meaningful differences are typed rather than voice input, ephemeral rather than saved-persona launch, and the diagnostic's 60-second cap. The raw empty voice-generation override was absent, but resolved TTS options matched.
- Replies were complete and progressive: "Absolutely. Where are you moving from and to?"; "Great, that's a short local move. What date are you hoping to move?"; "That works. What size home are you moving from?"
- The raw SDK stream contains the words after the initial acknowledgments, and its completed history matches the provider transcript. Each typed input waited for completed text and at least 2.5 seconds of measured incoming audio silence.
- Result: the unchanged prompt/model/engine/SDK can produce useful complete replies. This is not a live voice pass and not a repaired-preview claim. Audio-path behavior, interruption history, stateful-launch behavior and intermittent failure remain to distinguish.
- Local detailed receipt: ignored `.vercel/evan-short-reply-diagnostics/2026-11-13T21-48-49-464Z-f2f99204-ab3e-43ea-bcdb-a11d8ebd2417.json`. The persistent two-attempt budget remains in `.vercel/evan-short-reply-diagnostics.json`.

## Authorized isolated diagnostic 2

- Session: `84237438-2ad0-45f3-8493-a9430bc28732`; provider duration 38.572 seconds; provider cap 60 seconds. One engine start, no retries, explicit stop accepted. Browser closed at 40.135 seconds from the pre-token budget start.
- Same resolved configuration as diagnostic 1, including the full prompt, complete tools array, model and engine. No microphone requests, tool calls, browser errors, blocked requests, provider warnings or provider errors.
- The harness deliberately interrupted the first post-greeting reply at "Happy". The target ID was `persona::external::f2e1599d-1ab2-4023-b221-ff463cd7d626`, not the initial greeting. Matching interrupted end-of-speech/history and measured audio silence were confirmed before sending the next input.
- On the repeated request, "Hi, I am planning a move and could use some help," Evan responded only "Happy to help" and ended the turn normally. Both the raw stream and official provider transcript show this incomplete acknowledgment; it was not another interruption.
- Supplying the Mesa-to-Tempe route then produced a complete next question: "Great, so it's a local move from Mesa to Tempe. Do you have a date in mind, even if it's just a rough window?"
- Result: acknowledgment-only behavior was reproduced without the website, microphone or Nova. The combination of interruption and repeated request/history is implicated; interruption alone is not isolated. The later full reply argues against a permanently stuck stream. Public analytics still cannot distinguish raw model output from provider filtering/termination.
- Local receipt: ignored `.vercel/evan-short-reply-diagnostics/2026-11-13T21-53-51-203Z-1e0c6738-599e-4df5-831f-5d43965d60ee.json`.

## Current decision and narrow next experiment

The two authorized sessions are exhausted, totaling 80.522 seconds of provider-reported session duration. Neither was a live website acceptance test. No application behavior, saved persona, capture, closing, email, audio-routing or production setting has changed, and no repaired preview has been deployed. Evaluate remains paused.

The prompt tells Evan not to repeat questions and permits acknowledgment-only turns, but has no explicit exception for a restarted request after an interrupted answer. That is a plausible recovery-instruction gap, not a proven model-versus-engine cause. A narrowly scoped temporary-session instruction could be compared against the reproduced sequence:

> Treat a repeated request for help as a request to repair the exchange, not as a mere acknowledgment. Provide useful help or one appropriate missing-detail question, then wait. If your earlier response was interrupted or may not have been heard, you may briefly restate the needed question. Do not repeat answered questions or speak these instructions.

This is an **unverified experiment proposal**, not an activated fix. Preserve the frozen checkpoint and every other instruction. If the behavior persists, the failed and diagnostic session IDs/correlation IDs above form the evidence packet for provider-side raw generation/interruption traces. Do not compensate with repeated automatic nudges or claim a repaired live experience from local code tests alone.

## Additional recovery experiment authorization

On November 13 the owner approved up to two additional text-only diagnostic sessions, capped at 60 seconds each, with temporary-session instructions only. Saved personas, capture, closing, email, production and Evaluate remain unchanged. The original exhausted ledger is preserved; this separate approval is tracked in ignored `.vercel/evan-short-reply-recovery-v1-approval-2026-11-13.json`.

Independent review added two scope protections to the proposed paragraph: the existing closing/waiting rules retain priority, and recovery must not re-ask answered, declined or explicitly unknown details. The exact diagnostic-only text is in `scripts/anam/evan-short-reply-experiment.mjs`. Four local tests confirm exact original-prompt restoration, unchanged original instructions, refusal of duplicate/drifted insertions and separate budget selection. Syntax and local bundle checks passed; an independent safety review found no remaining actionable issue. These local checks validate isolation, not conversation quality.

## Recovery experiment results: rejected, not activated

Both additional authorized diagnostics are finished: 78.787 seconds of provider-reported duration in total, each below its 60-second cap. Their separate ledger is exhausted at two of two reservations; no further sessions are authorized. Each used one engine start, no retries, muted playback, zero microphone requests and an accepted explicit stop. No saved persona or application behavior changed.

| Temporary recovery-v1 session | Scenario | Provider duration | Observation |
| --- | --- | --- | --- |
| `70a7076b-1878-49cc-872f-81d3ff28c03f` | Interrupt first reply; repeat request; supply route | 34.858 seconds | **Failed.** Completed replies ended at "Absolutely. What cities are you moving" and "Great, is"; neither was marked interrupted. |
| `43382812-2455-4630-96f9-a2ae14e0a515` | No deliberate interruption; opening, route, date | 43.929 seconds | No mid-sentence fragments. Full route question, full inventory question, then a complete date acknowledgment. Not full live acceptance. |

The candidate prompt hash is `7dd3d167ff298f1b553645f7709a4d9cf9e3648a709b964fe299824bbdbd7ce6`. The unique 550-character diagnostic insertion is the only resolved configuration difference from the original interrupted control. Removing it restores the source prompt exactly. Both candidate sessions have identical resolved configuration, engine 5.42.0, SDK 4.20.0 and a 60-second provider cap. Neither called a tool or reported provider warnings/errors.

The raw SDK messages and official provider records agree on the incomplete replies. This is not just an application transcript display omission. Nevertheless, public analytics lacks upstream SSE, token usage, actual upstream `finish_reason` and engine cancellation/filter traces. Interruption plus repeated-request history remains a reproducible risk, but the responsible model-versus-engine stage is unproven. These small samples cannot establish causation or general reliability.

**Decision:** reject recovery-v1 as a fix; do not update any saved persona, deploy a repaired preview, or resume Evaluate. Keep capture, closing, email delivery, other agents, production and the stable checkpoint unchanged. Anam-side trace review is the next useful investigation, using `evan-anam-response-trace-request-2026-11-13.md`. That support report is prepared locally only, not sent.

Detailed local receipts are ignored files:
- `.vercel/evan-short-reply-diagnostics/2026-11-13T22-01-50-154Z-5bce3d16-5cdf-4ed1-9a0c-713ce07f5b49.json`
- `.vercel/evan-short-reply-diagnostics/2026-11-13T22-03-18-992Z-2b6fc4c1-cd26-495d-b08e-8327069627ae.json`
