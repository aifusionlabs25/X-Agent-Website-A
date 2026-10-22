# Evan run 15: discovery blocker and reproduced parser defects

Status: discovery remains below release threshold. The Qwen rehearsal call on `ddu0ju57b` failed closure and route capture, and Rob reported an unacceptable discovery monologue that the provider transcript alone cannot resolve. See `EVAN_RUN16_FINDINGS_2026-10-18.md`.

## Evidence

- Tested deployment: `x-agent-website-7nmxlyv1m-robs-projects-e72bad73.vercel.app`.
- Completed provider session: `b8740714-2080-4489-8301-2f06f31fa153`, October 18, 2026, 3:40 PM Phoenix, duration 3:21.
- Human-guided test report: `C:/Users/AI Fusion Labs/Documents/Codex/2026-10-17/so-hear-me-out-i-want/outputs/evan-live-test-results-2026-10-18-run15.md`.
- Provider session/transcript were independently retrieved through read-only Anam API requests. No new call or audio changes were made during this investigation.

## Discovery failure

At 1:01.429, the persona began the turn containing a home-size question followed by “Got it” and another large-items question. The skip-turn system tool started 0.441 seconds after that persona turn began and completed 0.003 seconds later, with a result requiring silence. Nova's next user turn began at 1:10.069. The combined persona turn was marked interrupted and lasted 8.441 seconds.

This is a hard fail: another actual customer answer did not occur between the two questions. The timing rules out the browser's 12-second skip recovery as the source of this continuation. The record does not expose individual model generation/utterance boundaries, so it does not by itself prove whether the model generated the second question before or after the tool result.

The run-15 provider session used **GPT OSS 120B**, `openai/gpt-oss-120b`, temperature 0.6, maximum output 4096 tokens, model ID `a7cf662c-2ace-4de1-a21e-ef0fbf144bb7`. This establishes the model used in that failed run; it does not prove that the model alone caused the failure. On October 18, the owner clarified that the intended Evan model is Qwen 3.6 27B.

Anam documents speech before a tool and continuation after its result within the same logical turn: [August 24 multi-utterance release notes](https://anam.ai/changelog). The current browser SDK is 4.20.0; newer utterance-aware SDK events may improve diagnosis, but an SDK upgrade alone would not establish that spoken generation obeys a one-question limit. Interrupting upon the first question mark in streamed text could clip the question before its audio finishes and is not being presented as a reliable fix.

## Reproduced website defects and local repairs

1. **First end request refused.** The exact statement, “That's clear, thanks. That answers it. I'd like to end the call now,” failed the local close detector. It now accepts bounded completed acknowledgment clauses before a direct end request while preserving continuation, quoted speech, question, and new-fact exclusions.
2. **Route absent.** “Gilbert, Arizona” and “Chandler, also in Arizona” were not recognized as concise answers. In addition, the preceding pickup readback contaminated the destination question's role detection. The parser now isolates the last question and accepts a bounded Arizona/AZ suffix only as context for that location answer. An unrelated favorite-city answer cannot become a route.
3. **Tentative kitchen help absent.** “I might want help packing fragile kitchen stuff” was discarded as hypothetical. It now remains visible under packing as possible help, without becoming a confirmed requested service. A later explicit refusal clears that interest.

Regression tests reproduce all three original failures and check relevant negative cases. No prompt, voice, model, or tool changes were applied remotely during the initial run-15 investigation.

## Candidate correction and retest

The owner requested **Qwen 3.6 27B**, `qwen/qwen3.6-27b`, ID `2032d289-6faa-46e6-819c-fbe4dd79a37a`, for the Evan replacement candidate. The model-only Anam update passed an idle-session check, saved a backup, and read back the candidate and published model IDs as Qwen. The prompt, avatar, voice, tools, speech detection, and other persona settings were verified unchanged. The corresponding website readiness pin and run-15 parser repairs are deployed at `x-agent-website-ddu0ju57b-robs-projects-e72bad73.vercel.app` without moving the public or shared rehearsal aliases. Both guest and email check-in issued valid session tokens on this preview.

One scoped live retest should use the same staged discovery scenario. The hard fail remains: a second question, paraphrase, or imagined answer before the caller responds. Test the first explicit end request and the Gilbert-to-Chandler and tentative kitchen-packing planner updates in the same call. A passing call requires repeat validation on the unchanged version before production promotion.

The prior `7nmxlyv1m` preview is stale because it pins the former model. Do not reuse it. The `ddu0ju57b` preview is also below release threshold after run 16.
