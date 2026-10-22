# Same-version consistency retest evidence

Session `dc526f39-1e91-4636-9b6a-a2ba8b1dc948`, preview `co4450x6s`. October 21 Phoenix 11:12:29–11:14:49 PM; provider duration139s,19messages,exit CLOSED_BY_ENGINE.

## Transcript timeline (UTC October 22)

- 06:12:29.997 Evan introduction.
- 06:12:38.931 caller says planning a move and needs help.
- 06:12:42.994 Evan asks origin/destination.
- 06:12:49.489 caller: From Mesa to Tempe. second week in November.
- 06:12:53.723 Evan repeats the week correctly and asks property type.
- 06:13:04.850 caller: It's a 2 bedroom apartment.
- 06:13:08.123 Evan asks boxes/furniture.
- 06:13:15.249 caller: About20–25boxes,queenbed,um,loveseat,desk.
- 06:13:20.985 Evan asks whether destination is another apartment or house.
- 06:13:28.852 caller: another apartment; one flight of stairs at pickup; delivery has elevator.
- 06:13:35.008 Evan asks packing needs.
- 06:13:44.036 caller: fragile dishes; packing/cost question.
- 06:13:49.435 Evan answers wrapping/packing available, staff confirms materials/charge.
- 06:14:00.047 caller requests possible call tomorrow about estimate.
- 06:14:05.107 Evan explicitly declines to promise tomorrow or book an estimate; states24–48hour follow-up with details.
- 06:14:19.887 caller supplies Jordan Avery,202-555-0146,jordan.avery@example.com.
- 06:14:29.108 Evan acknowledges, states24–48hours; NO contact readback.
- 06:14:39.717 caller explicitly requests ending.
- 06:14:45.140 Evan warmfarewell2.721s; providerclose06:14:49.

## Findings

Access PASS: Evaluate saw Origin one flight of stairs / Destination elevator; allthreeemailbodies retain both association and count. Filler PASS: literal um appears in providertranscript but not live inventory or any email. Phone correctly unconfirmed because no readback/yes occurred; not a confirmation-state regression. The positiveconfirmation case passed in preceding run49.

Capture failures: supplied second week IN November shortened to November; two-bedroom origin apartment shortened to apartment after destination property answer. Both losses present in observedplanner and allthreeemailbodies, so not only a display refresh issue. The generic opening is also retained as an unnecessary still-to-confirm note (cosmetic).

No repeated answered question, process stall, or persona interruption flag. Destination-property question is distinct from origin-size question. No unsupported tomorrow commitment this time. Existing rehearsal-versus-Mullins routing distinction remains.

## Runtime and email

Nine readycaptureupdates1→19facts141–185ms. Last06:14:44.388. Completion user_requested_end06:14:50.513; first finalizationcompleted06:14:52.518. Rawtooltrace/persistedcaptureobject not retrieved.

Admin sent06:14:51.556 toAIFL; Gmailreceipt1a1623f83f370d04,matching session withtranscript attachment. Sales sent06:14:51.570 toAIFL; Gmailreceipt1a1623f82f7b9f17. Visitor submitted06:14:52.059 tofictionalexampleaddress; provider-only, NOTinboxreceipt. Three bodies independentlyread; no resend.

No source, persona, routing or production change during review. No additionalcall started.
