# Evan Qwen dialogue candidate — pending live qualification

Scope: replacement-candidate Evan only. Do not promote to production from source tests alone.

## Why this candidate exists

Run 17 passed the route display and explicit farewell but failed discovery: Evan spoke an internal-sounding planning line, then left two long gaps and unnecessarily reconfirmed Gilbert. Provider timing showed the model completed those short utterances; it did not establish a slow or blocked tool request. See `EVAN_RUN17_FINDINGS_2026-10-18.md`.

The previous managed prompt had about 4,608 words and repeated listening, clarification, and closing instructions in several sections. It also directed Evan both to use supplied cities and to reconfirm consequential facts. The revised candidate has about 3,247 words (approximately 30% shorter), a single top-level conversation priority, and a narrow rule that clarifies only real ambiguity or conflict. It explicitly forbids speaking internal process text and preserves the existing knowledge, contact privacy, planner receipt, estimate, email, and close contracts.

## Model setting verified

The candidate Anam LLM is `qwen/qwen3.6-27b` via `groq_openai`, with temperature `0.7`, max tokens `4096`, and `reasoningEffort: none`. Groq's [Qwen 3.6 model guide](https://console.groq.com/docs/model/qwen/qwen3.6-27b) and [reasoning reference](https://console.groq.com/docs/reasoning) say `none` disables reasoning for this model and is appropriate for efficient dialogue. Therefore this change does **not** alter the model or claim a reasoning-setting leak caused the spoken line. Anam's [prompting guide](https://anam.ai/docs/personas/llms/prompting-guide) supports removing redundant and contradictory directions and testing against actual conversations.

## Release gate

1. Confirm zero active candidate sessions, back up the current persona, then use the guarded prompt-only updater. Verify the published prompt hash and all non-prompt persona settings are unchanged.
2. Build a unique rehearsal preview with the candidate readiness hash; do not move production or the shared rehearsal alias. Check guest and email entry.
3. Ask the evaluation chat to run the same discovery scenario at least three times on that exact preview. Hard fail if Evan speaks process text, repeats or rephrases a question before an answer, reconfirms a clear city, talks over the caller, misattributes planner details, offers unsupported guest follow-up, fails to update the planner, or fails explicit closure. A code test cannot substitute for this live gate.

## Verified candidate checkpoint

- The guarded Anam update applied only `systemPrompt` to the idle replacement candidate. A local backup was saved; delayed read-back matched the managed prompt and preserved model, avatar, voice, speech settings, and tools.
- Evan release tests: 354 passed. Full repository suite: Amy 103 passed, shared Anam 429 passed with one skipped, AgentMail 38 passed. TypeScript and local Next.js build passed with normal filesystem access.
- Rehearsal preview: `https://x-agent-website-15qm5krgf-robs-projects-e72bad73.vercel.app/demo/evan` on the existing protected `amy-ceo-rehearsal` environment. The unique deployment has no alias. Guest and synthetic-email entry both reached token issuance; no live media or email was sent by the smoke test.
- Public `xagent.aifusionlabs.app` still resolves to a separate production deployment. No production promotion occurred.

Run 18 on that preview had natural turn-taking and correct explicit closure in one call, but failed planner data accuracy: ground-floor delivery appeared under origin. It also did not visibly retain tentative fragile-kitchen packing, and Evan offered an email recap in guest mode. See `EVAN_RUN18_FINDINGS_2026-10-18.md`.

## Run 18 repair checkpoint

- The exact run-18 customer utterances are regression tests. The parser now keeps pickup stairs and ground-floor delivery on separate endpoints and retains possible kitchen-packing help alongside self-packing the remainder. These values are present in the Move Brief highlights, not just the raw model.
- The candidate prompt no longer offers to create a recap during conversation or turns tentative packing into a confirmed service. Guarded Anam update verified prompt hash `3a75f9f968a2e77893cbfffdee5979c7c9a1bbc012f790cedccd7df0a3e9644f` and preserved all other persona settings.
- Evan release tests: 357 passed. Full repository suite, TypeScript, and local Next.js build passed with normal filesystem access.
- New protected rehearsal preview: `https://x-agent-website-kg7i1kxmp-robs-projects-e72bad73.vercel.app/demo/evan`, unique deployment with no alias. Guest and synthetic-email website entry both reached candidate token issuance. Production still resolves to a separate deployment.

Status: ready for a scoped run-18 retest, **not** qualified for production. A live call must verify the visible access and packing details, guest follow-up wording, natural discovery across repeated calls, and automatic ending.
