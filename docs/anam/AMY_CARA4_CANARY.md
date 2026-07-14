# Amy stable Cara 4 canary

## Plain-English purpose

Amy's public Anam persona remains unchanged on Cara 3. A separate Anam persona lets us compare stable Cara 4 safely and roll back instantly by removing one preview environment variable.

The website keeps the normal public route:

- Public/control: `/demo/amy?qa=1`
- Cara 4 canary: `/demo/amy?qa=1&variant=cara4`

The `variant=cara4` request is resolved on the server. It works only for Amy and only when `ANAM_AMY_CARA4_PERSONA_ID` is configured. Unknown personas and variants fail closed.

## Source Amy snapshot

Snapshot checked on 2026-07-14 before canary creation:

- Public persona ID: `8c7d5b42-b17e-4321-8bfa-381c8d93820f`
- Public avatar model: `cara-3`
- Avatar supports: `cara-3`, `cara-4`, `cara-4-latest`
- Stable canary model: `cara-4`
- Source prompt SHA-256: `4f3a64542c79fee42896d513a9cc85c3a37d9b289fe9e86dd75e3eece5fff75e`
- LLM: GPT OSS 120B
- Attached tools: three, including the existing Insight knowledge tool

The canary creation script fetches Amy's current live prompt and configuration, appends the provider-neutral behavior upgrade in `config/anam/amy-cara4-behavior-upgrade.md`, creates a separate persona, and verifies the avatar, voice, LLM, tools, settings, and prompt hash. It will not overwrite a mismatched existing canary.

Canary created and verified on 2026-07-14:

- Canary persona ID: `0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08`
- Avatar model: stable `cara-4`
- Upgraded prompt SHA-256: `adddfbcad0aeba5d66dbeb18f7b4db0f6a01317a063b84720aa6b49cdbaa1b4b`
- Same source avatar, voice, GPT OSS 120B LLM, and all three tool attachments: verified

## Safety boundaries

- The current public Amy persona is never updated by the script.
- Tavus files and the Tavus deployment are read-only inputs and remain on hold.
- QA mode disables microphone input and does not call the transcript-save route.
- If normal voice mode is used on the Cara 4 canary, `/api/save-transcript` accepts only the message count and suppresses filesystem writes, LLM analysis, Google Sheets, and Resend email.
- `cara-4-latest` is intentionally excluded because it is the experimental track.
- Director Notes are deferred. Stable Cara 4 and the SDK upgrade are evaluated first without adding another variable.

## Validation ladder

1. Run `npm run test:anam`.
2. Run `npm run lint` and `npm run build`.
3. Confirm public Amy still starts in QA mode with no canary environment variable.
4. On a Vercel preview, compare public Amy and the Cara 4 canary with the same scenario.
5. Smoke-test one control agent, such as Taylor, because the SDK upgrade is shared by all X Agents.
6. Verify session startup, two-way text turns, interruption, visible framing, tools/knowledge, and the absence of `/api/save-transcript` in QA mode.
7. Do not change the production Amy persona mapping until the comparison passes.

## Fleet sequence after Amy

Once Amy passes, repeat the same process one agent at a time: snapshot, duplicate, stable Cara 4 canary, preview comparison, promote or roll back. Do not mass-change all persona IDs at once.
