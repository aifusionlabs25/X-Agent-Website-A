# Evan 6097 replacement: test deployment

> Current status, October22: **3/3 qualifying core-scenario passes** on immutable `2sijvsy43`. See [stable checkpoint and production-readiness gates](EVAN_STABLE_CHECKPOINT_2026-10-22.md). The older deployment instructions/results below are historical; they do not supersede this checkpoint. Production is unchanged.

Candidate: `6097c73e-b6ef-48c5-94c7-9a95d4863b99`.
Public website remains on the existing Evan until the candidate passes a human conversation test.

## October 17 access failure

The default Git Preview had no session-spine signing/storage configuration. Both check-in buttons therefore returned 503 before contacting Anam. The direct Anam WebSocket smoke did not exercise this website boundary. Default Preview also lacks the AgentMail key, so enabling guest access alone would not prove email check-in.

Use the existing protected `amy-ceo-rehearsal` custom environment in project `x-agent-website-a`, team `robs-projects-e72bad73`, for this candidate test. Despite its historical name, this environment already holds the required session and mail credentials. Do not copy production credentials, change its branch matcher, assign public domains, change the production main-only guard, or promote this test build. It has no configured custom domains.

For this deployment only, set `ANAM_RECOVERY_NAMESPACE=evan-6097-candidate` for runtime and build, and explicitly use `--target amy-ceo-rehearsal`. The installed CLI 49.2.0 accepted `--skip-domain` for the October 18 Qwen candidate deployment and kept the shared rehearsal alias unchanged. Verify the target remains a Preview environment with no public custom domains, and do not run alias or promote commands. This separates finalization due queues, Dani email retry queues, and recovery drain locks from the public site's queues. Per-session keys remain keyed by unique session IDs; this is queue isolation, not a separate database. Leave the setting absent for the normal production queue. Empty or invalid configured values fail closed.

## Required verification

1. Run `npm run test:evan:release`, `npm test`, and a build.
2. Deploy the reviewed commit to the custom environment, without assigning domains.
3. Get a share link through Vercel's authenticated access flow; never disable deployment protection.
4. Run `npm run anam:smoke:evan-website -- --url <immutable-url> --share-url <same-origin-share-url>`. This checks both check-in modes, signed-cookie persistence, consent isolation, actual website token issuance, and logout. It uses a synthetic email and sends no messages or live media. Tokens and cookies are never logged.
5. Verify the actual browser entry and public domain's deployment identity.
6. Human test: guest conversation and planner; email-enabled conversation, natural close, saved transcript, customer recap, Admin summary, and Sales brief. Do not equate token success with audio/video or three-email delivery.

Custom/Preview deployments do not receive the production cron. Completion already retries transcript retrieval inline. If Anam delivers the transcript later, recovery must be invoked against this exact candidate deployment using its authorized recovery route and namespace. Do not drain the public queue or claim indefinite background recovery from this test build.

Never reuse an older immutable Preview URL after configuration changes: it retains its original environment snapshot.

## October 21 contact and handoff candidate

- Protected immutable preview: `https://x-agent-website-95opwfmel-robs-projects-e72bad73.vercel.app/demo/evan` (use its same-origin Vercel share link for browser access). Target: `amy-ceo-rehearsal`; no domain assignment or production promotion.
- Evan Anam candidate `6097c73e-b6ef-48c5-94c7-9a95d4863b99` received a system-prompt-only update. Model, voice, avatar, tools, and other personas were verified unchanged. Managed prompt SHA-256: `064320db7499a8db22cb7445255c4ac46ca785c6d5d9f17b63bb14dc5325bbe2`.
- Name, phone, and email spoken together remain visible in planner working notes. Voluntarily sharing a clear email enables one post-call visitor recap plus Sales and Admin briefs without a second consent checkbox. Evan reads contact details back once for accuracy and accepts correction or refusal without pressing again. Phone-only callback requests remain internal demo leads, not customer email.
- The current Admin and Sales destinations are both `aifusionlabs@gmail.com` for rehearsal. They are **not** Mullins inboxes; this preview must not tell a visitor Mullins received the briefs or promise a Mullins callback. The approved 24–48-hour follow-up message is enabled in conversation only after actual Mullins routing is configured. Internal Sales guidance asks for contact as soon as possible after receipt.
- The server sends internal briefs before the visitor recap, records one attempt per session, and changes the visitor's next-step copy if Mullins delivery was not confirmed. A spoken refusal suppresses even a website-selected recap.
- Verification: 389 Evan release tests, 49 AgentMail regression tests, full repository suite (103 + 443 passed, one skipped + 49), and TypeScript passed. Local `next build` was blocked by Windows path canonicalization; Vercel's rehearsal build compiled and type-checked successfully. No-call website smoke passed both guest and synthetic-email check-ins through token issuance. A real conversation and actual three-message delivery still need testing.

## October 21 packing-answer repair after run 45

- Run 45 on `95opwfmel` stalled after Evan twice said he would check fragile-dish packing and charges. The Anam session record showed no recorded knowledge-tool calls, so a broken lookup was not established. The three rehearsal messages did arrive at the AI Fusion Labs destination after the operator ended the call; that does not count as a natural-close pass.
- Mullins' public services page already supported packing and showed dish wrapping. Added the explicit, source-backed answer in `09_packing_fragile_dishes.md` to Evan's isolated candidate knowledge group. Exact price, materials, item eligibility, and date availability still require Mullins staff confirmation.
- The candidate prompt now answers this question directly and forbids announcing a check that was not started or stopping after only saying it is checking. The Anam candidate prompt and all nine knowledge documents passed read-back; model, voice, avatar, and tool attachments were unchanged.
- New protected, unaliased rehearsal preview: `https://x-agent-website-kbuc3dfp3-robs-projects-e72bad73.vercel.app/demo/evan`. It pins prompt SHA-256 `39ec515166edc8a88c305ba1e0274eb416e0aae3494e46101a298439bd5e0c2b`. Use this preview rather than the older `95opwfmel` build. Production and shared rehearsal domains were not changed.
- Verification: 389 Evan release tests, 49 AgentMail tests, TypeScript, remote Vercel build, and both guest and synthetic-email no-call entry paths passed. A live human retest is still required to confirm the answer is spoken promptly and the conversation continues normally.

## Run 46 accepted baseline and consistency sequence

Run 46 on `kbuc3dfp3`, session `fd7ce401-c5dd-4153-a4cd-9b110b564922`, answered the packing question promptly and closed on the first explicit request. The planner populated live move/contact fields. Rob listened, accepted the early opening overlap and approved demo follow-up wording, and confirmed receipt of the emails. Record this as an overall PASS; the earlier two cautions are user-accepted observations, not outstanding failures for this demo.

Both implementation and testing reviewers independently scored 100/100 under the [shared live-test benchmark](EVAN_LIVE_TEST_BENCHMARK.md). Run 46 is pass 1 of 3 on the unchanged candidate. The next two comparable tests should use the same deployment, prompt, knowledge, configuration, and audio setup. The opening-recovery suggestion is documented for later consideration and has not been applied to the live candidate. Rehearsal mail still goes to AI Fusion Labs; the demo script does not establish actual receipt by Mullins staff.

## October 21 run-47 scoped repair preview (current)

Run 47 failed at 70/100 from both reviewers, resetting the old sequence to 0/3. Rob then authorized only three fixes: preserve a bundled self-introduction in planner/email identity, capture love seat and desk inventory, and accept the first explicit closing request even when preceded by "Got it." See [repair checkpoint](EVAN_RUN47_REPAIR_CHECKPOINT.md) for exact scope and evidence.

Current protected preview: `https://x-agent-website-he64svj9h-robs-projects-e72bad73.vercel.app/demo/evan`, deployment `dpl_Cdtbj1wzvsfEeJoqs9LtsMn5VCuo`. It is READY in `amy-ceo-rehearsal` with no assigned aliases. The live prompt, nine knowledge documents, model, voice, avatar, tools, audio setup, and email destinations are unchanged from run 47. Production remains on `dpl_532oXZx47MLz9UWBmRWkzDx4dqLF`.

Verification passed: 110 focused tests, 394 Evan release tests, the full repository suite, TypeScript, changed-source lint, local and remote builds, and protected guest/email website entry through token issuance. No live call or email was started by verification. The Evaluate chat receives the exact protected share URL and the unchanged scorecard. A new code version starts at 0/3; live planner behavior, named email delivery, and first-request ending still require the next comparable human-directed test.
