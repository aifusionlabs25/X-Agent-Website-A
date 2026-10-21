# Shared access for the private pilot

All ten agent profiles remain public. Conversations, meeting invitations, notes,
memory controls, and external actions require a verified account and a current
agent permission. A missing configuration or unavailable authorization store
denies access. There is no public/guest bypass switch.

## Visitor and owner flow

Visitors use `/access` to request a single-use email sign-in link. The link lasts
10 minutes; a signed-in session lasts four hours. Verification alone grants no
agent permissions. An unapproved visitor can request access from an agent's
launch page. Requests appear in `/access/admin`; they do not send an owner email.

The owner signs in at `/access/admin`, approves an email for an individual agent,
chooses permissions, and sets an expiry from one to 90 days (seven by default).
The form can approve an email before a request exists. It does not send an
invitation email. Share the existing agent URL through your usual channel.

Permissions are independent:

- **Conversations:** start an agent and use its session tools and notes.
- **Meeting invitations:** create and manage agent meeting invitations.
- **Email and external actions:** permit outbound follow-up and legacy transcript
  automations. The existing agent's consent and delivery checks still apply.

Amy's old access-code form becomes a preferences step after shared approval.
`AMY_ANAM_MEMORY_ACCESS_CODE` is no longer required or read by this flow.
Her memory and follow-up choices are optional. Her identity comes from the
verified account, not an editable email field. Dani and Evan keep their existing
agent-specific recap/preferences UI, behind the common gate; their contact
identity also uses the verified account.

The owner can revoke a grant, decline a request, or pause an agent for everyone
(including the owner). New requests cannot extend an approval, add a capability,
or overwrite a concurrent owner decision. Additional requested capabilities
appear for review without granting them.

## Deployment configuration

The rollout reuses the existing Redis REST service and Resend account. It does
not provision another paid service or copy production secrets into previews.

- `AMY_ANAM_REDIS_REST_URL` and `AMY_ANAM_REDIS_REST_TOKEN`: existing connection;
  access records use dedicated `xagent:access:*` namespaces.
- `RESEND_API_KEY`: existing email service. Sign-in mail uses
  `X Agents <hello@aifusionlabs.app>` on the existing domain.
- `XAGENT_AUTH_SECRET`: optional dedicated secret, at least 32 characters. If
  absent, a purpose-specific key is derived from `AMY_ANAM_SESSION_SECRET`.
  An explicitly empty value fails closed. Never expose it as `NEXT_PUBLIC_*`.
- `XAGENT_ACCESS_OWNER_EMAILS`: comma-separated owner emails. When absent, the
  established site owner `aifusionlabs@gmail.com` is used. Set this explicitly
  when transferring ownership. An empty value grants owner access to nobody.
- `XAGENT_ACCESS_DISABLED_AGENTS`: optional emergency pause, a comma-separated
  list of registry slugs or `*`. Dashboard Resume cannot override this setting.
- Local development uses `NEXTAUTH_URL=http://localhost:3000`. Production is
  pinned to `https://xagent.aifusionlabs.app`; a stale conflicting NEXTAUTH_URL
  fails closed. Vercel previews use their exact generated deployment origin.

Auth.js/NextAuth 4.24.15 owns email verification, CSRF handling and database
sessions, using the maintained Upstash adapter. The adapter's verification-token
consume is made atomic with GETDEL, and sessions and verification records receive
explicit Redis expiry. Authorization records are checked on every protected
operation; permission decisions are never stored in a browser-editable flag.

## Enforcement and isolation

`lib/access/policy.ts` is the common authorization boundary. It protects the
shared Anam issuer, James's separate launchers, meeting handlers, browser-owned
session data, and transcript/evaluation endpoints. The old agent cookies remain
necessary for session ownership but do not prove account approval. Each new
agent browser context is bound to its verified account; an old or other-account
cookie cannot be adopted by a newly signed-in account.

Provider/worker/operator endpoints retain their existing service authentication.
Internal finalization and cleanup can continue, but outbound mail checks the
stored account's current actions permission again before delivery. Pre-rollout
sessions without a shared-account binding cannot send new follow-ups.

## Practical limits

Revocation blocks new requests and pending email at the next permission check.
It does not recall an email already sent or terminate an external audio/video
stream already running. Provider-side meeting reservations already accepted
may also need cancellation in the meeting/provider controls. Treat a grant
revocation as separate from terminating those existing external activities.

The dashboard shows the most recent 200 requests/approvals and stores these
records for at most 120 days after a write. It is not a complete usage/audit-log
console. Public marketing forms remain public.

## Verification before promotion

Run `npm test`, `npm run build`, and lint changed files. The shared access suites
exercise the real Auth.js session flow with stubbed Redis/Resend, concurrent
one-time redemption, all ten anonymous launches, grant scope/expiry/revocation,
cross-account browser contexts, worker rechecks, and owner-only mutation routes.

Review the access page and owner controls in a preview before production
promotion. Preview environments without authentication secrets intentionally
return 503 and never issue a provider token. Do not enable public access or
copy production secrets merely to make a preview launchable.

After promotion, verify every anonymous agent/session/meeting route is denied,
then have the owner request their own sign-in email and confirm the dashboard.
Email receipt, a real approved voice session, and provider-side cancellation
require separate live checks; offline tests are not proof of those outcomes.
