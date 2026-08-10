# Dani returning-memory rollout

Status: implementation and managed Anam configuration are prepared; memory must remain fail-closed until every phase below passes.

Dani has her own browser-session signature, encrypted-contact key, Redis namespace, verified email identity, consent state, encrypted approved-memory records, and operator promotion gate. No Dani secret or identity tool may fall back to Amy's.

## Production environment contract

Set secrets in Vercel environment variables or an untracked local file. Never commit or paste their values into a command, ticket, transcript, screenshot, or chat.

Always required for Dani website sessions:

| Variable | Requirement |
|---|---|
| `DANI_ANAM_SESSION_SECRET` | Random value of at least 32 characters. Distinct from every Amy and Dani secret. Rotating it invalidates active Dani browser sessions. |
| `DANI_ANAM_CONTACT_SECRET` | Separate random value of at least 32 characters. Rotating it invalidates in-flight contact and follow-up tokens. |

Fail-closed initial state:

```dotenv
DANI_ANAM_MEMORY_ENABLED=false
DANI_ANAM_MEMORY_KILL_SWITCH=true
DANI_ANAM_MEMORY_PROMOTION_ENABLED=false
DANI_ANAM_MEMORY_PROMOTION_KILL_SWITCH=true
```

Additional values required before recall can be opened:

| Variable | Requirement |
|---|---|
| `DANI_ANAM_REDIS_REST_URL` | HTTPS REST endpoint for Dani's memory store. A dedicated database is preferred. |
| `DANI_ANAM_REDIS_REST_TOKEN` | Token for that endpoint; minimum 24 characters in Production. |
| `DANI_ANAM_MEMORY_IDENTITY_SALT` | Random value of at least 32 characters. Changing it creates a new identity lane. |
| `DANI_ANAM_MEMORY_ENCRYPTION_KEY` | Exactly 32 bytes encoded as base64, or 64 hex characters. Do not rotate without a record migration. |
| `DANI_ANAM_MEMORY_VERIFICATION_SECRET` | Separate random value of at least 32 characters for one-time email verification. |
| `DANI_ANAM_MEMORY_CONFIG_FINGERPRINT` | Exact SHA-256 fingerprint described below. |

Email verification uses Dani's AgentMail provider configuration, so `DANI_EMAIL_PROVIDER=agentmail`, the Dani mailbox and recipient values, `AGENTMAIL_API_KEY`, and all explicit Dani mail/tool/action gates must also be valid.

Promotion remains independent from recall. Open it only for deliberate, reviewed operator decisions:

```dotenv
DANI_ANAM_MEMORY_PROMOTION_ENABLED=true
DANI_ANAM_MEMORY_PROMOTION_KILL_SWITCH=false
DANI_ANAM_MEMORY_OPERATOR_SECRET=<separate random value of at least 32 characters>
```

The production build contract rejects promotion when recall is closed. It also rejects reused Dani session, contact, verification, and operator secrets.

## Configuration fingerprint

Normalize `DANI_ANAM_REDIS_REST_URL` by removing trailing slashes. Compute SHA-256 over these exact UTF-8 values, joined by one NUL byte in this order:

1. normalized Redis URL;
2. Redis token;
3. identity salt;
4. encryption key exactly as stored in the environment;
5. verification secret.

This command reads values from an untracked `.env.local` and prints only the fingerprint:

```powershell
node --env-file=.env.local --input-type=module -e "import {createHash} from 'node:crypto'; const e=process.env; const u=String(e.DANI_ANAM_REDIS_REST_URL??'').trim().replace(/\/+$/,''); console.log(createHash('sha256').update([u,e.DANI_ANAM_REDIS_REST_TOKEN,e.DANI_ANAM_MEMORY_IDENTITY_SALT,e.DANI_ANAM_MEMORY_ENCRYPTION_KEY,e.DANI_ANAM_MEMORY_VERIFICATION_SECRET].map(v=>String(v??'').trim()).join('\0'),'utf8').digest('hex'))"
```

Install the result as `DANI_ANAM_MEMORY_CONFIG_FINGERPRINT` in the same Vercel scope as the five source values. Recalculate it after any source value changes.

## Staged rollout

### 1. Deploy the backend boundary with memory closed

1. Schedule the change when no Dani calls are active; the new session secret intentionally invalidates legacy Dani cookies.
2. Install the two Dani session/contact secrets and explicit Dani AgentMail gates in Preview and Production.
3. Keep both memory features disabled and both kill switches active as shown above.
4. Run `npm run test:anam:dani`, `npm run test:anam:agentmail`, `npm run verify:deploy-contract`, and `npm run build` with the intended scoped configuration.
5. Deploy the site. Verify guest entry, opted-in entry, call completion, and all three follow-up emails. Do not proceed while any email or ownership check fails.

The live Anam persona may remain on its current prompt and four-tool set throughout this phase.

The local deploy-contract command intentionally skips unless `VERCEL_ENV=production` and `VERCEL_GIT_COMMIT_REF=main` are present. Vercel runs it automatically during the Production prebuild.

### 2. Add Dani's dedicated Anam identity tool and prompt

Keep memory closed in Vercel during this phase.

1. Load `ANAM_API_KEY` securely into the operator shell.
2. Prepare only the dedicated tool:

   ```powershell
   npm run anam:update:dani -- --prepare-identity-tool --confirm=CONFIRM_DANI_CARA4_SYNC
   ```

3. Pin the returned `identityToolId` in `config/anam/dani/persona-manifest.json` and review the diff.
4. Before changing the provider, update `lib/anam/persona-readiness.ts` and its tests to accept exactly two temporary baselines: the currently published four-tool prompt and the reviewed five-tool prompt/tool IDs. Deploy that transition contract while the old persona is still published, then verify Dani can still start. Never publish the provider change while the site accepts only the old baseline.
5. Run the read-only plan with `npm run anam:update:dani`, then apply with an absolute backup directory outside the repository:

   ```powershell
   npm run anam:update:dani -- --apply --confirm=CONFIRM_DANI_CARA4_SYNC --backup-dir="C:\AI Fusion Labs\X AGENTS\BACKUPS\Dani Anam"
   ```

6. The updater modifies the provider draft only. **Manually publish Dani in Anam.** Record the new `publishedAt` readiness baseline, then run `npm run anam:audit:dani`.
7. Confirm the exact five-tool set includes `confirm_dani_live_identity` and never Amy's `confirm_live_identity`.
8. Tighten `lib/anam/persona-readiness.ts` back to the single audited five-tool baseline and deploy again. Do not open memory until the tightened readiness check and a fresh Dani launch both pass.

### 3. Enable verified recall, then promotion

1. Provision Dani's memory values in a Preview-only scope first and calculate the matching fingerprint.
2. Set `DANI_ANAM_MEMORY_ENABLED=true` and `DANI_ANAM_MEMORY_KILL_SWITCH=false`; leave promotion disabled and killed.
3. Deploy Preview and test successful OTP verification, wrong/expired/replayed OTP rejection, guest isolation, returning recognition, memory revocation/deletion, and Amy/Dani cross-agent isolation. Responses and logs must not reveal raw email, identity hashes, memory text, or verification codes.
4. Install the same reviewed configuration suite and fingerprint in Production, deploy from `main`, and repeat a designated-identity smoke test.
5. Only after recall is stable, optionally open promotion with a separate operator secret. Every write must bind to an explicit reviewed candidate and canonical digest; there is no automatic transcript-to-memory write.

## Candidate production and operator review

The finalizer seam is:

```ts
prepareDaniAnamMemoryReviewCandidate({ session, receipt, turns })
```

It runs only after the exact final Anam transcript has produced its completed Dani receipt and while `turns` still exists in process memory. The helper rechecks Dani's persona, agent, variant, final session state, receipt source, message count, transcript SHA-256, and an active consent-linked Dani session identity in Dani's dedicated memory store. It returns a deterministic categorical review artifact containing no transcript, email, user prompt, or automatic-approval instruction.

The sanitized artifact and canonical receipt are committed in one transaction to the shared session-spine Redis under one exact session-and-job key. The artifact is immutable and expires with the canonical session record after seven days. The raw `turns`, email, identity hash, and Dani memory records are not written to the spine store. Dani's approved notes remain encrypted in her dedicated memory store.

Revocation wins at every later boundary: the candidate read endpoint rechecks the active Dani session identity, and promotion rechecks active consent again before writing an approved note. A revoked pending candidate therefore becomes unreadable immediately even though its sanitized bytes may remain in the spine store until the seven-day TTL expires. There is no candidate list, scan, newest, or automatic approval path.

Set these only in the operator's untracked local environment:

```dotenv
DANI_ANAM_MEMORY_PROMOTION_URL=https://<exact-reviewed-deployment>/api/anam/dani/memory/promote
DANI_ANAM_MEMORY_CANDIDATE_URL=https://<exact-reviewed-deployment>/api/anam/dani/memory/candidate
DANI_ANAM_MEMORY_OPERATOR_SECRET=<matching scoped operator secret>
```

Review one exact stored artifact. Copy the three content-free identifiers from the finalizer's candidate-commit event; never discover or select a newest candidate:

```powershell
npm run dani:memory-review -- --review --external-session-id=<exact-session-id> --job-id=<exact-64-hex-job-id> --candidate-digest=<exact-64-hex-digest>
```

After the displayed sanitized summary and next steps are deliberately reviewed, record exactly one decision with the same identifiers. The CLI fetches the stored artifact again before submitting the decision, and the server ignores operator-authored summary text:

```powershell
npm run dani:memory-review -- --approve --external-session-id=<exact-session-id> --job-id=<exact-64-hex-job-id> --candidate-digest=<exact-64-hex-digest>

npm run dani:memory-review -- --reject --reason=operator_rejected --external-session-id=<exact-session-id> --job-id=<exact-64-hex-job-id> --candidate-digest=<exact-64-hex-digest>
```

The CLI rejects implicit selection, multiple modes, unsupported fields, digest mismatches, and any mismatch among the operator-supplied session ID, job ID, digest, stored artifact, and canonical receipt. Review mode performs one bearer-authenticated exact-candidate GET and no write. Approval is never the default.

## Emergency close and recovery

Set both kill switches to `true`, set both enabled flags to `false`, and redeploy. The Anam tool can stay attached because the backend will reject recall and writes.

Do not rotate the identity salt or encryption key during an incident. Preserve the exact Redis URL, token, salt, encryption key, verification secret, and fingerprint as one recoverable configuration suite. Restore that suite, reopen recall in Preview, repeat the isolation and deletion tests, and only then reopen Production.
