# Amy AgentMail integration

Amy's Anam follow-up email path is server-only and uses `amy-insight@agentmail.to`.

## Safety contract

- The recipient comes only from the website check-in form.
- The normalized address is encrypted into a short-lived HttpOnly, same-site contact token bound to the signed browser session.
- The raw address is never returned to Amy, placed in an Anam tool argument, reconstructed from speech, written to returning memory, or stored in the Redis receipt.
- Amy must first provide a useful exchange and receive explicit permission in the current conversation.
- The `send_follow_up_email` client tool passes only `userConfirmed: true`. The browser then calls the same-origin server route with the bound launch/session IDs and current transcript signals.
- The server verifies browser, launch, Anam session, identity, contact token, rate limit, and every outbound capability gate before calling AgentMail.
- The follow-up is a deterministic, redacted working summary. User text is not treated as instructions and all HTML is escaped.
- One send attempt is reserved per Anam session. An ambiguous upstream result is never automatically retried, preventing accidental duplicate email.
- Redis stores only a content-free action receipt. It stores neither recipient address nor message body.
- Hermes remains backend-only and does not perform the send.

## Required environment

```text
AMY_EMAIL_PROVIDER=agentmail
AMY_AGENTMAIL_ADDRESS=amy-insight@agentmail.to
AGENTMAIL_API_KEY=<server-only secret>
AMY_ANAM_AGENTMAIL_ENABLED=true
AMY_ANAM_AGENTMAIL_KILL_SWITCH=false
AMY_ANAM_TOOLS_ENABLED=true
AMY_ANAM_TOOLS_KILL_SWITCH=false
AMY_ANAM_OUTBOUND_ACTIONS_ENABLED=true
AMY_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH=false
```

The existing session-spine URL, token, and signing secret must also be present and enabled.

## Activation order

1. Deploy the application code and confirm `/api/anam/session/email` is available.
2. Verify every AgentMail and outbound environment gate.
3. Run `npm run anam:update-amy-agentmail` with the Anam API key and Cara 4 persona ID available locally.
4. The script creates or updates `send_follow_up_email`, attaches it to Amy, installs the managed prompt block, and verifies both.
5. Start a fresh website check-in so the encrypted contact token exists, then test one requested email.

The Anam tool is deliberately attached only after the receiving backend is deployed. This avoids a period where live Amy can call a tool that production cannot handle.
