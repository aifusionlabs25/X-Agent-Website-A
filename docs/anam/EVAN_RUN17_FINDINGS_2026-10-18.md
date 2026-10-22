# Evan Qwen candidate: run 17 findings

Status: **hard fail for live discovery**. Keep candidate persona `6097c73e-b6ef-48c5-94c7-9a95d4863b99` on Qwen 3.6 27B for further investigation; do not promote this preview or change production.

## Evidence

- Tested isolated preview: `x-agent-website-g8z7corzt-robs-projects-e72bad73.vercel.app`.
- Provider session: `cf2886c1-4975-49e1-8ca3-b435590a8aa1`, October 18, 2026, 4:15 PM Phoenix, 3:55 duration.
- Human test report: `C:/Users/AI Fusion Labs/Documents/Codex/2026-10-17/so-hear-me-out-i-want/outputs/evan-live-test-results-2026-10-18-run17.md`.
- Rob reported that Evan was severely broken in the audible conversation and Nova had to rescue it. Do not downgrade that observation merely because the transcript does not show a continuous monologue.

## What passed

- The spoken Gilbert-to-Chandler route appeared as two city-level pins and in the Move Brief.
- Possible help packing fragile kitchen items remained tentative in the brief.
- The first explicit end request triggered the end tool, the prescribed farewell, and automatic page exit.

## What failed

- At 1:29 Evan audibly said, “I need to ask a clarifying question,” an internal-sounding statement rather than a visitor-facing question. No further agent speech is transcribed until Nova prompted him at 2:05.
- At 2:15 Evan asked Nova to reconfirm Gilbert, though the caller had already stated it and the planner displayed it. After her 2:28 confirmation, Nova had to prompt again at 2:55 for next steps.
- These gaps and redundant confirmation are a discovery hard fail. The Qwen model pin, route fix, and close fix are not proof of a natural or reliable conversation.

## Decision

Do not promote. Review the recording alongside the transcript to distinguish response-generation, turn-boundary, and tool/orchestration behavior before changing the prompt or starting another live call. Preserve the passing route and closure regressions. Production and the shared rehearsal alias remain unchanged.
