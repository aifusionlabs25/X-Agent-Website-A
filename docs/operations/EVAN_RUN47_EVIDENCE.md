# Run 47 evidence review

Reviewed October 21, 2026 (Phoenix); provider timestamps below are UTC on October 22. This is a read-only review of one authorized consistency test. No new call, deployment, prompt, knowledge, audio, or application-code change was made.

## Exact identity

- Preview: `https://x-agent-website-kbuc3dfp3-robs-projects-e72bad73.vercel.app/demo/evan`
- Vercel deployment: `dpl_CGSssXSvosAaVWrv8LoBdPx98Caw`
- Anam session: `489d6940-a780-4b37-9afa-e4ddef5da986`
- Persona: `6097c73e-b6ef-48c5-94c7-9a95d4863b99`
- Session snapshot system-prompt SHA-256: `39ec515166edc8a88c305ba1e0274eb416e0aae3494e46101a298439bd5e0c2b` (matches baseline).
- Started `00:21:09.925Z`; ended `00:23:38.000Z`; provider transcript duration 147,821 ms.
- Provider exit status: `CLOSED_BY_ENGINE`.
- Testing chat observed automatic navigation back to `/agents/evan`, without operator Exit.

## Provider transcript

These are the exact recorded words, not a fresh speech-recognition pass. Text and provider interruption flags cannot independently grade vocal nuance or physical audio overlap.

| UTC | Speaker | Recorded text |
| --- | --- | --- |
| 00:21:10.405 | Evan | Hi, I'm Evan with Mullins Moving. Tell me a little about the move you're planning, and I'll help you work through the details. |
| 00:21:19.040 | Caller | Thanks Evan. I'm moving from Mesa to Tempe in the second week of November. |
| 00:21:24.978 | Evan | That's a short local move, and second week of November gives the team some flexibility. What size home are you moving from? |
| 00:21:34.265 | Caller | It's a 2 bedroom apartment. |
| 00:21:37.289 | Evan | Good, that helps. Do you know roughly how many boxes, or the main furniture pieces you'll be moving? |
| 00:21:45.621 | Caller | About 20 to 25 boxes and a queen bed. There's also a love seat and a desk. |
| 00:21:54.982 | Evan | That's a manageable 2 bedroom load. Do you need help with packing or unpacking, or will you handle that yourself? |
| 00:22:03.839 | Caller | Hmm, do you help pack fragile dishes? And would that cost extra? |
| 00:22:10.329 | Evan | Yes, Mullins offers packing help, including wrapping dishes. The team can confirm materials and any extra charge for your move. |
| 00:22:20.660 | Caller | Okay. Thanks. What happens next? Could someone call tomorrow about an estimate? |
| 00:22:27.956 | Evan | Thanks, I have the move details and the dish-packing question noted. If you'd like, I can email a short recap after the call so the team can follow up on an estimate. |
| 00:22:40.343 | Caller | Sure. I'm Jordan Avery. My phone is 202 555 0146 and my email is jordan.avery@example.com. |
| 00:22:50.408 | Evan | Thanks Jordan. Did I get that right, two oh two, five five five, oh one four six, and jordan.avery at example dot com? |
| 00:23:02.420 | Caller | Yes, that's exactly right. |
| 00:23:05.312 | Evan | Great. After our call ends, I'll send the moving details and the dish-packing question to the Mullins team so they can follow up on an estimate. |
| 00:23:15.541 | Caller | Got it. No, that's everything. I'd like to end the call now, please. |
| 00:23:21.921 | Evan | Thanks, Jordan. I'll send the recap over so the team can follow up on the estimate and dish-packing details. |
| 00:23:30.250 | Caller | Thanks. Goodbye. |
| 00:23:32.978 | Evan | Thank you for speaking with Mullins Moving. Take care. |

All ten persona turns have `wasInterrupted: false`. No repeated size/discovery question or empty checking/stall turn is present. No knowledge tool call was recorded; the dish answer was direct, so this is not evidence of a broken knowledge request.

## Contact and inventory findings

The caller DID supply Jordan Avery in the bundled contact turn. Evan used the first name, but did not read back the full name. The testing chat's last contact observation was `Not shared yet` for name, with phone and email confirmed.

Replaying the complete provider transcript through the unchanged local functions gives:

- `buildEvanPlannerContact`: `displayName: ''`; phone `(202) 555-0146`, confirmed; email `jordan.avery@example.com`, spoken and confirmed.
- `extractEvanConsentedGuestLead`: both `displayName` and `nameForReview` are null; phone and email retained.
- `extractEvanGuestRecapRecipient`: address retained; `displayName: 'Visitor'`.
- `buildEvanMovePlan`: Mesa to Tempe, second week of November, 2 bedroom apartment; inventory ONLY Queen bed and About 20 to 25 boxes. Love seat and desk are absent. Fragile items and apartment access are present.

This is a deterministic reconstruction, not a captured final browser-state dump. It agrees with the tester's observed contact omission. The delivered internal emails independently confirm the generic Visitor identity.

The current name parser recognizes explicit `my name is`, certain opening greetings, answers to a direct name question, and a narrow bundled-contact form. `Sure. I'm Jordan Avery...` following a recap offer fits none of those paths. The inventory label rules do not include love seat or desk. These are code extraction gaps; the provider transcript retained the words.

## Close receipt and reproduction

The session contains one recorded tool invocation:

- `end_mullins_session`, client tool, turn 8; tool-call ID `b849fzxve`.
- Started `00:23:20.752Z`; completed `00:23:20.812Z` (60 ms); status completed; no provider error.
- Result: `status: continue_conversation`, `accepted: false`, `retryAllowed: false`.
- Instruction begins: `This is a deliberate refusal, not a tool failure. Do not say goodbye, retry this tool, or restart a readback.`

The first explicit end request was therefore refused by the application guard, not ignored because Qwen failed to call the tool. Local read-only reproduction:

```text
hasEvanCloseIntent("Got it. No, that's everything. I'd like to end the call now, please.") = false
hasEvanCloseIntent("No, that's everything. I'd like to end the call now, please.") = true
hasEvanCloseIntent("Thanks. Goodbye.") = true
```

The leading `Got it.` is enough to trigger the false negative. The call eventually ended after a second goodbye, about 22.5 seconds after the first request started, or 18.7 seconds after its recorded 3.74-second spoken duration. This misses the benchmark's first-request/~10-second criterion. No second end-tool invocation is recorded; do not label the later closure as an accepted end-tool result.

Vercel records, deployment above, session reference `ef5da986`:

- `00:23:39.434Z`: session completion, `closeReason: user_requested_end`, queued.
- `00:23:41.411Z`: post-session dispatch, `status: email_sent`, `sent: true`, `afterSessionClose: true`, `finalTranscriptAvailable: true`.
- `00:23:41.473Z` / `.474Z`: finalization completed on attempt 1.

## Email evidence

AgentMail has exactly three outgoing messages in the bounded `00:23:38Z`–`00:25:00Z` window from `hermes-hal@agentmail.to`:

| UTC | Purpose | Actual recipient | Evidence |
| --- | --- | --- | --- |
| 00:23:40.461 | Sales brief | aifusionlabs@gmail.com | Subject `[ACTION] Mullins move lead - Visitor`; Gmail ID `1a160fdffbe91856`; recipient-inbox receipt verified. |
| 00:23:40.478 | Admin brief | aifusionlabs@gmail.com | Subject `[EVAN SESSION] Visitor - 2m 28s - transcript attached`; Gmail ID `1a160fdffadc3b1e`; recipient-inbox receipt verified; body names the exact session ID. |
| 00:23:41.065 | Visitor recap | jordan.avery@example.com | AgentMail sent ID `<010001a160fdff3e-fe4f011b-5682-4526-9982-78e09e8f1d6e-000000@email.amazonses.com>`; provider acceptance verified, recipient-inbox delivery NOT verified. This is the fictional test address. |

Both received internal bodies say Visitor, retain the phone/email, and include route/timing. The visitor recap begins `Hi there`. Actual recipients were not Mullins. The rehearsal recap explicitly says the briefs went to AI Fusion Labs, not Mullins; preserve Rob's approved fictional spoken handoff without pretending real delivery occurred.

The brief bodies do not carry the specific love seat/desk inventory or dish-packing/extra-charge question (the Admin transcript attachment is the separate record). They use a generic Quote requested summary and list a callback number among missing details while also displaying the captured number. These are secondary summary-quality observations for follow-up; no new repair was made during this fixed-version review.

## Handoff

Use benchmark v1 for independent scoring. Do not increment the streak based solely on natural-looking UI navigation. Confirmed issues are lost supplied name, missing volunteered inventory in the reconstructed planner, and refusal of the first clear end request. No additional test is authorized by this report. Preserve run 46's user-accepted pass without retroactively rescoring it.
