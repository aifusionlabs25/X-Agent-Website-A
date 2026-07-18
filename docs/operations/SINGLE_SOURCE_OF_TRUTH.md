# X Agent single source of truth

## Canonical production system

| Concern | Canonical source |
| --- | --- |
| Product code and website | GitHub repository aifusionlabs25/X-Agent-Website-A |
| Production branch | main |
| Hosting | Vercel project x-agent-website-a |
| Public site | https://xagent.aifusionlabs.app |
| Amy experience | app/demo/amy and the Amy Anam API routes in this repository |
| Amy prompt upgrades | config/anam |
| Amy knowledge archive | knowledge/amy |
| Operational guidance | docs/operations |
| Production secrets | Vercel Production environment only |

A change is not production-ready until it is committed here, reviewed on a preview deployment, merged to main, and verified on the public domain.

## Reference-only sources

The following locations remain useful archives, but they are not deployment sources:

- C:/AI Fusion Labs/X AGENTS/REPOS/Insight Amy
- Tavus Amy repositories and worktrees
- Local Anam experiments outside X-Agent-Website-A

Do not delete these archives until the copied prompt and knowledge material has been compared and accepted. Do not deploy from them.

## Branch policy

- main is the only production branch.
- Feature branches are used for preview and verification.
- Production promotion requires the deployment contract to pass.
- A rollback is preferred over editing secrets during an incident.
- Never copy Preview secrets over Production merely because Vercel hides an existing sensitive value.

## External systems

Some runtime state cannot live in Git:

- The Anam dashboard owns the published persona, avatar, voice, model, knowledge attachment, and transcription or retention settings.
- Redis owns Amy's pseudonymous identity associations and approved memory notes.
- AgentMail owns Amy's mailbox and delivery activity.
- Hermes runs only behind the server boundary and must not be exposed in the browser.
- Vercel owns production secret values and deployment history.

Changes to any of those systems must be recorded in the production runbook and verified against this repository's expected configuration.
