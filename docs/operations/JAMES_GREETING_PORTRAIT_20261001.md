# James greeting and website portrait — October 1, 2026

The public website at `xagent.aifusionlabs.app/demo/james` uses Anam persona
`8a991c93-0c95-42c5-8c22-a67428946eb8`, the same ID as the owner's Lab build link.
The production token route sends only this persona ID, with no prompt or avatar
override. Published Anam edits therefore apply to newly started website sessions.

## Findings and narrow repairs

- The published persona now uses Cara 4 avatar `bd18978d-9b78-4072-b8ac-4748c629bbfa`.
- Both homepage card rows and the detail page consumed the legacy `James Knowles Law Firm 1.jpg`.
  Their shared `lib/agents.ts` entry now uses `james-knowles-cara4-20261001.png`,
  copied directly from this persona's current Anam avatar preview.
- Anam's `skipGreeting` was already false, but `initialMessage` held 7,024
  characters of internal SUFFICIENCY CHECK, RECAP AND NORMAL CLOSE, and ENDING
  THE CALL instructions. This is a configuration defect consistent with the
  reported opening regression; the exact historical session cause was not traced.
- A partial persona PUT changed only `initialMessage` to:
  `Hi, this is James with Knowles Law Firm. What's going on today?`
- The readback confirmed the full owner system prompt, Knowledge/tool attachments,
  avatar, voice, model, language, turn-taking, retention and remaining settings
  were preserved. Owner prompt SHA-256:
  `8fe9a37217af15456fc163d92b7fd4d6134ecc5fb5d6fdc28e0f32c3de405361`.
- The supplied October 1 prompt is fully present within Anam's published prompt;
  additional surrounding text is Anam's standard voice-conversation instructions.
  No SP or KB rewrite was performed.

## Verification and maintenance

`scripts/anam/audit-james-opening.mjs` checks this exact persona and greeting.
By default it is read-only and returns a failure status for a mismatched opening.
Its `--repair --snapshot <path>` operation is restricted to the observed misplaced
closing block, guards against owner edits after the snapshot, and verifies other
settings after the partial PUT. The owner's attachment and pre-repair configuration
are retained locally under `work/james-refresh-20261001/`, outside the commit.

The opening check verifies configuration, not audible speech. A fresh session is
needed for caller-facing acceptance; an already-open Lab tab may need reloading.
The separate September 23 v2 candidate and September 27 hosted canary are not
activated or altered by this portrait/greeting repair.

The inspected live persona still reports `zeroDataRetention: false`. This repair
does not establish provider zero retention or satisfy the earlier privacy release
gate for broader James rollout.

Website base/rollback commit: `bad87a27b9185577fa7feffa846d796a26a2e975`.
Previous production deployment: `dpl_61AoMStYx3oQtqUKpRRYJeZZr7ce`.
Validation: the normal Next.js 16.3.1/Turbopack production build and TypeScript
checks pass. Browser inspection of the built site confirmed both homepage James
cards and both detail-page image elements load the new asset. Both homepage cards
lead to `/agents/james`, whose live-demo link remains `/demo/james`. No browser
errors were observed. A fresh authenticated Anam Lab build page displays the exact
repaired first greeting with Skip greeting off. No new provider call was started.

Publishing this website commit through the existing main-branch Vercel integration
updates the static cards; the Anam greeting repair is already saved independently.
