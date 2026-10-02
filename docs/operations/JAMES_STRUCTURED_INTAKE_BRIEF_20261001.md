# James progressive intake brief

## What changed

The website legal pad is now a structured intake brief, not a running list of
things the visitor said. James starts in the full-width layout. The first
supported intake fact opens the split layout automatically. A visitor can still
hide or reopen the pad; later facts do not override that choice.

The brief groups supported details into Client, Matter, Timing & location, and
Additional context. Greetings, pacing requests, spelling fragments and other
conversation controls are omitted. Unknowns, meaningful negatives and questions
for attorney review are retained in the appropriate named field. Unsupported
wording remains private evidence rather than being guessed into a visible fact.

This is deterministic, source-bound extraction and projection, not a new LLM
summary. It is intentionally conservative and cannot promise to understand every
ASR error or novel phrasing. Name, phone and email readbacks are individual
confirmations, not proof of identity or mailbox ownership. An alternate email
does not replace the primary contact address.

## Review and correction

Finalization reconciles supported corrections, removes duplicates and builds a
versioned brief. Event, payment, hearing, document, receipt and reported response
dates stay separate. It does not invent calendar dates, years or legal deadlines.

The brief becomes ready for review when the basic fields and contact checks are
complete. The visitor can also select **Review intake brief** earlier; any gaps
remain visibly open. Closing the call performs the same finalization after the
existing provider transcript verification. A greeting-only call can still close.

While the media connection is active, code may issue one fixed spoken invitation
to review the ready brief. It uses Anam's exact-speech `talk` command, not prompt
language asking the model to choose a layout or approve its own notes. Delivery
requires measured output silence and no active visitor/persona speech. If that
cannot be established, review remains available in the UI; no guessed interruption
or automatic repeated invitation is attempted. This spoken timing still needs
live qualification with the installed SDK.

The visitor can correct a named field using the form or provide a supported
spoken correction. Typed edits have their own authenticated evidence and receipt;
they are not forged provider transcript turns. A meaningful change invalidates
the earlier confirmation. **Confirm brief** acknowledges only the current version;
it does not end the call, submit to Knowles, or consent to email.

## Email and existing James behavior

Both email drafts use the same current structured brief. Preparing drafts now
requires its confirmation and complete required fields in addition to the
existing verified-close, sender, grant and recipient gates. Actual sending still
needs separate explicit post-call approval. Email remains off by default.

The published James persona, prompt, knowledge bank, model, greeting, avatar and
voice are unchanged. Website tokens still select the owner's current published
persona. These layout/state changes apply to the website integration, not Anam's
standalone Lab interface. Legacy canary sessions retain their older contract;
start a fresh website call to use the structured brief.

## Verification and release status

- All 86 James regressions pass, including the real HTTP handler with fake
  provider/storage/email transports: browser authentication, stale version
  rejection, one invitation reservation, no model-authorized confirmation,
  closure gating, corrections, two-email consent and replay protection.
- The existing shared website suite passes (548 passing, one deliberate skip).
- TypeScript, focused lint and the optimized production build pass.
- Offline browser fixtures demonstrate full-width start, greeting-only hidden
  pad, automatic first-fact reveal, sticky Hide, field editing, revised review,
  and confirmed summary, with no browser warnings/errors observed.
- The development-only fixture route returns HTTP 404 without fixture details
  in a local production server.
- No live microphone call, provider change or real email send was performed
  during this revision. Speech timing and real ASR remain unqualified.

The owner requested push and deployment so the next fictional live test can run
on the website. That test still needs to qualify first-fact reveal, a corrected
name/date, natural review invitation, current-version confirmation, Hide behavior
and normal ending. Deployment status is recorded separately in the owner handoff;
the automated checks above do not imply a passed live microphone test.
Do not enable email as part of this layout release. Use the existing
main-branch deployment process and retain the previous production for rollback;
no provider rollback is needed because provider configuration was not changed.

Core implementation: `lib/james-canary/structured-brief.ts`,
`lib/james-canary/pad-visibility.ts`, `components/james/JamesCanary.tsx` and the
existing isolated James server/email handlers. Local visual rehearsal:
`/demo/james-brief-preview` in development only.
