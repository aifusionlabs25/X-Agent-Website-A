# Amy Anam feature workbench

This is the production boundary for Amy's live Anam feature layer. The browser renders deterministic working views from the current session transcript. Anam decides when to open a view through CLIENT tools; the display itself does not call an LLM or execute an external action.

## Features online

1. **Live Notes** groups current-session signals by organization, scale, environment, priorities, constraints, timing, stakeholders, requested outputs, and decisions.
2. **Live Brief** summarizes the objective, environment, priorities, discussion points, open questions, and next step.
3. **Roadmap** creates a four-stage working path aligned to the detected solution lane and confirmed session facts.
4. **Visual Brief** presents a deterministic six-slide microdeck: executive snapshot, what we heard, environment and constraints, recommended path, phased roadmap, and decisions.
5. **Solution Catalog** shows directional solution categories aligned to the conversation.

## Reliability rules

- Contact details are omitted from every workbench view.
- Uncertain speech is isolated as a clarification item and is not promoted to a confirmed fact.
- Explicit corrections replace rejected terminology throughout the views.
- Known platform terms are normalized, including Intune, SCCM, Microsoft 365 E5, Manhattan WMS, CrowdStrike, and Honeywell.
- Every visual is a working view based on the conversation so far, not a completed assessment or specialist approval.
- The catalog never claims live inventory, pricing, availability, lead time, or contract eligibility.

## Tool routing

| Visitor request | Anam CLIENT tool | View |
| --- | --- | --- |
| "Show my notes" | `show_live_notes` | Live Notes |
| "Show a brief" | `show_session_brief` | Live Brief |
| "Build a roadmap" | `show_solution_roadmap` | Roadmap |
| "Show a visual" | `show_visual_brief` | Visual Brief |
| "Show solution categories" | `show_solution_catalog` | Solution Catalog |

Tool calls are display-only and must not fire during a farewell.

## Hermes boundary

Hermes remains backend-only. The live workbench does not give Hermes a browser loop, Anam tool authority, CRM access, email authority, scheduling authority, or autonomous outbound authority.

Hermes may later receive a reviewed post-session packet for shadow analysis or operator-approved refinement. PDF/PPT export stays deferred until that reviewed packet is the source of truth; exports must not be generated from a partial live transcript.

## Release verification

Run:

```powershell
npm run test:anam
npm run build
```

Then test one request for each named view. Include these reliability checks:

- Correct a term in one turn and confirm the old term disappears.
- Say an uncertain phrase and confirm it appears only under clarification.
- Ask for catalog categories and confirm Amy states the commerce-data boundary.
- End the call and confirm no display tool fires during the farewell.
