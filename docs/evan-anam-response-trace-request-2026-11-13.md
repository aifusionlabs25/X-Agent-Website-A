# Anam support: incomplete completed replies after interruption

Prepared November 13, 2026. **Draft only — not sent.** All timestamps below are UTC for provider log correlation. No API keys, tokens, private links or real customer contact details are included.

## Request

Please inspect raw upstream generation and engine interruption/stream processing for the sessions below. Evan sometimes ends a reply after an acknowledgment or in the middle of a sentence, while public analytics marks the turn `completed` and `wasInterrupted: false`.

We reproduced the symptom in a minimal JavaScript SDK client without microphone input, Nova, website application logic, capture, closing guards or email integrations. A narrow recovery-prompt experiment did not fix it and has not been applied to a saved persona. We are not asserting a confirmed model or Anam engine defect; the public telemetry cannot distinguish them.

## Runtime and isolation

- SDK `@anam-ai/js-sdk` 4.20.0; engine 5.42.0.
- LLM ID `2032d289-6faa-46e6-819c-fbe4dd79a37a`; Groq OpenAI format; `qwen/qwen3.6-27b`; max tokens 4096; temperature 0.7; reasoning effort `none`.
- Rehearsal source persona `3720fcf6-f9fd-4b7c-b384-af559d0c84b2`. No saved persona was modified during diagnostics.
- Diagnostics used ephemeral copies with provider cap 60 seconds, token maxSessions 1, SDK retries disabled and independent earlier stop safeguards.
- Input used the SDK's `sendUserMessage()`. The interrupted scenario used `interruptPersona()` once, on the first response's first nonempty speech chunk. Before subsequent input, the harness required matching interrupted end-of-speech/history plus at least 2.5 seconds of measured incoming audio silence.
- Output was muted; microphone input was disabled and `getUserMedia` denied. Zero microphone requests, browser errors or blocked network requests were recorded. No client tools were invoked in these calls.
- Raw SDK stream events and completed history match the official session transcript. The missing continuation is not present in another public transcript field or page.

## Comparisons

| Session | Prompt | Input sequence | Outcome |
| --- | --- | --- | --- |
| `111492d0-326e-4171-bd2a-6c0edc6c9f19` | Frozen checkpoint | Actual website voice call | Several completed short replies, two interrupted replies; owner manually ended the call. |
| `d39ee234-95de-49d0-9c19-5ba60c011683` | Frozen checkpoint | Typed opening, route, date; no interruption | Three complete useful replies; 41.950 seconds. |
| `84237438-2ad0-45f3-8493-a9430bc28732` | Frozen checkpoint | Typed opening; interrupt first reply; repeat opening; route | Interrupted "Happy", then completed "Happy to help", then a full route/date question; 38.572 seconds. |
| `70a7076b-1878-49cc-872f-81d3ff28c03f` | Temporary recovery paragraph only | Same interrupted typed sequence | Completed mid-sentence fragments after the deliberate interruption; 34.858 seconds. |
| `43382812-2455-4630-96f9-a2ae14e0a515` | Same temporary recovery paragraph | Typed opening, route, date; no interruption | Full route/inventory questions and complete date acknowledgment; 43.929 seconds. |

Frozen full prompt hash: `39ec515166edc8a88c305ba1e0274eb416e0aae3494e46101a298439bd5e0c2b`.

Temporary recovery prompt hash: `7dd3d167ff298f1b553645f7709a4d9cf9e3648a709b964fe299824bbdbd7ce6`. Its only difference is a 550-character paragraph on recovering a restarted request, with existing closing/waiting rules retaining priority. Original instructions remain unchanged. This experiment was rejected, not activated.

The resolved model, tools, voice/TTS, VAD/STT, greeting, language and other comparable runtime settings match. The only resolved difference between the original and recovery interrupted diagnostics is `systemPrompt`; the two recovery diagnostics have identical resolved configuration. All diagnostic calls reported zero tool calls, warnings or errors.

An earlier accepted session, `4f1671a1-36a0-4b7a-a897-57d6befd05e6`, used engine 5.36.0 with the same original full prompt, model and actual voice/STT/VAD configuration. Engine version is an investigation lead, **not proof of regression**.

## Exact trace targets

Session `70a7076b-1878-49cc-872f-81d3ff28c03f`, November 13, 2026 UTC:

| Field | Broken question | Broken route acknowledgment |
| --- | --- | --- |
| Correlation ID | `external::f56812af-aa3a-435b-950c-a7d77c6e80f4` | `external::3fb28973-b8c0-4208-ba5d-b8a8670be272` |
| User input | Hi, I am planning a move and could use some help. | I am moving from Mesa, Arizona to Tempe, Arizona. |
| Input time | 22:02:09.852 | 22:02:18.916 |
| LLM first → final output | 22:02:10.883 → 10.897 | 22:02:19.533 → 19.543 |
| Speech start → stop | 22:02:11.224 → 13.705 | 22:02:19.905 → 21.265 |
| Recorded output | Absolutely. What cities are you moving | Great, is |
| Turn finish | completed | completed |
| Interrupted | false | false |

Preceding deliberately interrupted response: `external::10428c49-7e24-4fa1-8e65-5abb8c184271`, spoken 22:02:04.344–04.625, recorded "Sure, ". This was the first post-greeting reply, not a replayed greeting.

## Please determine

1. Did Groq actually generate only these fragments, or did Anam stop, filter or discard later content? Inspect raw `choices[0].delta.content`, upstream `finish_reason`, output-token usage and any cancellation/stop settings.
2. What conversation context reached the model after the interrupted answer? Was unsaid generated text retained as if the caller heard it?
3. Did an interruption or cancellation from the first turn carry into later turns, or cause their response streams to be finalized prematurely?
4. Does the text-input path differ from recognized speech at this boundary, and is there a supported fix or engine configuration relevant to this symptom?

Please retain the existing model and saved persona settings while investigating. We have paused live acceptance testing. There is no request here to change production or another agent.

Local reproducibility harness: `scripts/anam/diagnose-evan-short-replies.mjs` and `.entry.mjs`. Credentials are supplied privately through environment variables; they are not embedded in this report or the harness. Both owner-approved diagnostic budgets are exhausted; further calls require renewed approval.
