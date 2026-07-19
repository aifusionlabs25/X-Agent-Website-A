# Evan Mullins AgentMail

Evan uses the same security and delivery pattern as Amy, translated to the Anam Mullins workflow.

## What happens

1. The visitor types a name and email in the secure website check-in. The email is encrypted in an HttpOnly, session-bound cookie and is never supplied to Evan or Anam.
2. During the conversation Evan must receive explicit permission before calling `send_mullins_follow_up_email`.
3. The tool queues a content-free, Redis-backed intent. It does not send during the call.
4. After Anam reports the session closed, the backend verifies session ownership, retrieves the final Anam transcript, writes the durable session receipt, and then attempts exactly one three-message AgentMail bundle.
5. Delivery receipts are namespaced to Evan and prevent duplicate sends.

## Messages

- Visitor: thank-you, working recap, Mullins phone/email/address/website, and a clear non-quote disclaimer.
- Mullins Admin: operational session summary and sanitized transcript. Default recipient: `aifusionlabs@gmail.com`.
- Mullins Sales: move details, quote/walkthrough brief, captured requirements, missing information, and sanitized transcript. Default recipient: `aifusionlabs@gmail.com`.

Admin and Sales are separate messages and have separate configuration so the Sales address can be changed later.

## Sender and configuration

The verified AgentMail inbox is `hermes-hal@agentmail.to`. The originally supplied `heremes-hal@ageentmail.to` contained two spelling errors and is not used.

Evan can use dedicated `EVAN_*` gates. When those overrides are absent, he inherits the already-reviewed Amy session-spine and outbound-action gates, while retaining a separate sender, Redis namespace, templates, prompt, and Anam tool.

See `.env.example` for the optional overrides.

## Safety boundaries

- No spoken-email capture or correction loop.
- No Tavus webhook/session code.
- No send until the final Anam transcript and durable session receipt exist.
- Visitor delivery must be confirmed; ambiguous delivery is not retried automatically.
- Email permission does not book a move, confirm a quote, guarantee availability, or create an appointment.
- Transcript contact data is redacted before templating; the verified typed email is used only in the recipient and authorized internal headers.
