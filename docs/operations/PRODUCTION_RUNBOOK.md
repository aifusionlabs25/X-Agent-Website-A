# Production runbook

Dani's session-isolation and returning-memory rollout is deliberately staged. Follow [Dani returning-memory rollout](../anam/DANI_RETURNING_MEMORY.md); do not combine the backend deployment, Anam draft/prompt change, manual Anam publish, and memory enablement into one cutover.

## Current safety state

Production remains pinned to the known-good rollback until this branch is reviewed and merged to main. The future-deployment memory configuration has been repaired and verified:

- The original Upstash URL and token were recovered from the private Insight Amy worker environment.
- Redis contained exactly one approved history key and one approval decision.
- The known-good deployment confirmed that history belongs to the designated rvicks@gmail.com test identity.
- A new random identity salt was created, stored in the Windows user environment, and installed as a Vercel sensitive value.
- The sole approved history record was copied to the new pseudonymous identity key; the old key was retained.
- Matching URL, token, salt, and fingerprint values were installed in Vercel Production and the Amy feature-branch Preview scope.
- An isolated Preview check-in returned authenticated true and approvedMemoryCount 1 without returning raw email, identity hash, or memory content.

The identity salt remains part of the user lookup key. Replacing it creates a different identity lane even when the email is typed correctly. It cannot be reconstructed from the stored hash, so the Windows user-level backup and configuration fingerprint must be preserved.

## Before a production deployment

1. Confirm the branch is main and the worktree is clean.
2. Confirm the Vercel project is x-agent-website-a and the public domain is xagent.aifusionlabs.app.
3. Confirm the Anam Amy persona ID is the published Cara 4 Amy persona intended for this site.
4. Confirm Zero Data Retention is off, transcription is on, and the session type supports Anam transcripts.
5. Confirm the following Production values come from the same known-good memory configuration:
   - AMY_ANAM_REDIS_REST_URL
   - AMY_ANAM_REDIS_REST_TOKEN
   - AMY_ANAM_MEMORY_IDENTITY_SALT
6. Confirm the configuration fingerprint without printing the secrets:
   - SHA-256 of Redis URL without a trailing slash, a NUL byte, Redis token, a NUL byte, and identity salt.
   - It must match AMY_ANAM_MEMORY_CONFIG_FINGERPRINT in Production.
7. Confirm AgentMail, when selected, uses amy-insight@agentmail.to and a valid AGENTMAIL_API_KEY.
8. Run npm run test:anam and npm run build.
9. Verify a Preview session before merging.
10. Merge to main and let the production deployment contract run.

For Dani deployments, also confirm `DANI_ANAM_SESSION_SECRET` and `DANI_ANAM_CONTACT_SECRET` are distinct, both Dani memory kill switches are active during the backend-first phase, and the dedicated Dani memory fingerprint matches before recall is enabled.

Dani's verified three-email follow-up uses a separate, durable retry gate even while returning memory is disabled. Before promoting Dani AgentMail, confirm:

- `DANI_ANAM_EMAIL_RECOVERY_ENABLED=true`
- `DANI_ANAM_EMAIL_RECOVERY_KILL_SWITCH=false`
- `DANI_ANAM_EMAIL_RECOVERY_PRODUCTION_APPROVED=true`
- `CRON_SECRET` is a distinct random secret of at least 32 characters.
- `vercel.json` contains the `slot=a` 10:00 UTC and `slot=b` 22:00 UTC recovery jobs. Each expression runs once daily, so the linked Hobby project invokes Dani recovery about every 12 hours without requiring a Pro-only sub-daily expression.

Failed or partial Dani bundles enter a Dani-only sorted-set queue in the existing session-spine Redis. Recovery refetches and verifies the final Anam transcript against the immutable receipt, then retries only missing Visitor, Admin, or Call Summary lanes. Each lane reuses the same AgentMail idempotency key and byte-stable message body. Recovery fails closed and removes the queue item at 23 hours from the first attempt; never manually retry an expired item because AgentMail's idempotency key expires after 24 hours.

Never paste secret values into Git, tickets, transcripts, screenshots, or chat.

## Required smoke test

Use a designated test identity with Remember me enabled.

1. Open /demo/amy from the production domain.
2. Complete check-in and verify Previous conversation found.
3. Confirm Amy does not speak the email address or infer a name from the login form.
4. Start a session and confirm audio input, transcript capture, and explicit end-call behavior.
5. Open Notes, Brief, Roadmap, Visual, and Catalog and confirm the side panel updates.
6. End the call and confirm session finalization.
7. Verify the approved memory count and AgentMail delivery separately.
8. For an injected or observed partial Dani delivery, confirm the retry-due member is removed after all three lane receipts exist. A pending member must be drained by the next 10:00/22:00 UTC slot; an item older than 23 hours must terminate without another provider send.

## Incident response

If a deployment loses memory:

1. Stop new promotions.
2. Roll back to the last deployment that passes the returning-user smoke test.
3. Do not rotate the identity salt.
4. Compare environment names and scopes without exposing values.
5. Recover the exact prior Redis URL, token, and salt from the secret owner or provider.
6. Update the fingerprint only after the triple is verified.
7. Repeat the smoke test before a new promotion.

A successful rollback restores service but does not repair the project-level Production variables used by future builds.
