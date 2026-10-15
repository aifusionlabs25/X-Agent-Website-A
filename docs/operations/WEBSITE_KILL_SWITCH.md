# X Agents website emergency controls

The public site has a reversible maintenance mode controlled by the Vercel Production variable `MAINTENANCE_MODE`.

## Desktop controls

Run `scripts/ops/install-website-kill-switch.ps1` once to install two explicit desktop shortcuts:

- **X Agents Website - TAKE OFFLINE** sets `MAINTENANCE_MODE=true`, rebuilds the current production deployment, and verifies that the public domain returns the branded HTTP 503 maintenance screen.
- **X Agents Website - RESTORE ONLINE** sets `MAINTENANCE_MODE=false`, rebuilds the current production deployment, and verifies that the normal site is available again.

Each shortcut requires the operator to type a confirmation word before it changes production. The website remains online if the control window is closed or the confirmation does not match.

The shortcuts use the Vercel CLI session already authenticated on this Windows account. They do not contain a Vercel token or other secret. A short, non-secret activity log is stored at `%LOCALAPPDATA%\AI Fusion Labs\X Agents Website Control\website-control.log`.

## What “offline” means

Public page routes return the branded maintenance page with HTTP status 503. API routes and static files remain available so scheduled recovery, webhook, and operational workflows are not abruptly broken. This is an application maintenance switch, not a DNS deletion or deployment removal.

Changing a Vercel environment variable does not modify an already-running deployment. The controls therefore redeploy the current production build after updating the variable. Allow roughly one to three minutes for either action.

## Manual fallback

From a Vercel-linked checkout, set the Production value and rebuild the current production deployment:

```powershell
'true' | vercel env update MAINTENANCE_MODE production --yes --scope robs-projects-e72bad73
vercel redeploy https://xagent.aifusionlabs.app --target production --scope robs-projects-e72bad73
```

Use `false` instead of `true` to restore the site.

## Safe verification

The controller supports a dry run that changes nothing:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/ops/set-website-state.ps1 -State offline -DryRun
```

