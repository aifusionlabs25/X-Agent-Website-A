# Amy post-session email integration

Amy's Anam follow-up email path is server-only. Internal operations and Insight intake messages use `amy-insight@agentmail.to`. The visitor lane is independently selectable with `AMY_VISITOR_EMAIL_PROVIDER`: `agentmail` preserves the original all-AgentMail path, while `resend` sends the same visitor template and Visual Brief attachment from the verified `aifusionlabs.app` domain. This isolation prevents a visitor-provider delivery problem from changing Amy's persona, session, memory, workbench, or internal notification behavior.

## Safety contract

- The recipient comes only from the website check-in form.
- The normalized address is encrypted into a short-lived HttpOnly, same-site contact token bound to the signed browser session.
- The raw address is never returned to Amy, placed in an Anam tool argument, reconstructed from speech, written to returning memory, or stored in the Redis receipt.
- The standard three-message post-session bundle is authorized at private website check-in and queued only after the session is bound. Amy never asks for email permission, repeats the address, or reconstructs it from speech.
- The `send_follow_up_email` client tool is retained only for an optional, independently volunteered callback preference and compatibility. It has no conversational email-consent field. The browser calls the same-origin server route with the bound launch/session IDs and current transcript signals.
- The server verifies browser, launch, Anam session, identity, contact token, rate limit, and every outbound capability gate before calling either configured email provider.
- The follow-up is a deterministic, redacted working summary. User text is not treated as instructions and all HTML is escaped.
- One logical send attempt is reserved per Anam session, with stable provider idempotency keys on recovery so a retry does not create a second copy of an already accepted lane.
- Redis stores only a content-free action receipt. It stores neither recipient address nor message body.
- Hermes remains backend-only and does not perform the send.

## Required environment

```text
AMY_EMAIL_PROVIDER=agentmail
AMY_AGENTMAIL_ADDRESS=amy-insight@agentmail.to
AGENTMAIL_API_KEY=<server-only secret>
AMY_VISITOR_EMAIL_PROVIDER=agentmail # or resend
AMY_RESEND_FROM_ADDRESS=Amy from X Agents <hello@aifusionlabs.app>
RESEND_API_KEY=<server-only secret, required only when visitor provider is resend>
AMY_ANAM_AGENTMAIL_ENABLED=true
AMY_ANAM_AGENTMAIL_KILL_SWITCH=false
AMY_ANAM_TOOLS_ENABLED=true
AMY_ANAM_TOOLS_KILL_SWITCH=false
AMY_ANAM_OUTBOUND_ACTIONS_ENABLED=true
AMY_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH=false
```

The existing session-spine URL, token, and signing secret must also be present and enabled.

## Activation order

1. Confirm `/api/anam/session/email` is present in the release candidate and verify every email-provider and outbound environment gate.
2. Run `npm run anam:update-amy-workbench` without apply flags. Review the dry-run plan and its exact persona, prompt, tool-inventory, and provider-state hashes.
3. Follow the `applyRequirements` emitted by that fresh dry run exactly: explicit apply/confirmation flags, every current expected hash, and an absolute backup directory outside the repository. It installs AgentMail together with Amy's prompt, greeting, and complete isolated tool surface in one verified persona transaction.
4. Publish and deploy the matching website release only after the Anam transaction verifies successfully.
5. Start a fresh website check-in so the encrypted contact token exists, then verify the standard three-message post-session bundle.

The retired `anam:update-amy-agentmail` writer must not be used. AgentMail is deliberately managed by the same guarded transaction as Amy's other prompt and tool changes so production cannot drift into a partially updated state.
