# Evan 6097 replacement: test deployment

Candidate: `6097c73e-b6ef-48c5-94c7-9a95d4863b99`.
Public website remains on the existing Evan until the candidate passes a human conversation test.

## October 17 access failure

The default Git Preview had no session-spine signing/storage configuration. Both check-in buttons therefore returned 503 before contacting Anam. The direct Anam WebSocket smoke did not exercise this website boundary. Default Preview also lacks the AgentMail key, so enabling guest access alone would not prove email check-in.

Use the existing protected `amy-ceo-rehearsal` custom environment in project `x-agent-website-a`, team `robs-projects-e72bad73`, for this candidate test. Despite its historical name, this environment already holds the required session and mail credentials. Do not copy production credentials, change its branch matcher, assign public domains, change the production main-only guard, or promote this test build. It has no configured custom domains.

For this deployment only, set `ANAM_RECOVERY_NAMESPACE=evan-6097-candidate` and deploy with `--skip-domain`. This separates finalization due queues, Dani email retry queues, and recovery drain locks from the public site's queues. Per-session keys remain keyed by unique session IDs; this is queue isolation, not a separate database. Leave the setting absent for the normal production queue. Empty or invalid configured values fail closed.

## Required verification

1. Run `npm run test:evan:release`, `npm test`, and a build.
2. Deploy the reviewed commit to the custom environment, without assigning domains.
3. Get a share link through Vercel's authenticated access flow; never disable deployment protection.
4. Run `npm run anam:smoke:evan-website -- --url <immutable-url> --share-url <same-origin-share-url>`. This checks both check-in modes, signed-cookie persistence, consent isolation, actual website token issuance, and logout. It uses a synthetic email and sends no messages or live media. Tokens and cookies are never logged.
5. Verify the actual browser entry and public domain's deployment identity.
6. Human test: guest conversation and planner; email-enabled conversation, natural close, saved transcript, customer recap, Admin summary, and Sales brief. Do not equate token success with audio/video or three-email delivery.

Custom/Preview deployments do not receive the production cron. Completion already retries transcript retrieval inline. If Anam delivers the transcript later, recovery must be invoked against this exact candidate deployment using its authorized recovery route and namespace. Do not drain the public queue or claim indefinite background recovery from this test build.

Never reuse an older immutable Preview URL after configuration changes: it retains its original environment snapshot.
