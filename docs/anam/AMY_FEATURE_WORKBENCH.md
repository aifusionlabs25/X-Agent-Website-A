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

## Future roadmap: live canvas and presentations

Status: discovery for later discussion.

1. **Embedded live canvas:** evaluate the tldraw SDK inside the Visual tab, driven by the same canonical session model as Notes, Brief, and Roadmap. Start read-only and browser-local.
2. **Guided user corrections:** add an explicit edit mode with undo and a separate correction overlay. User edits do not become Amy context until the visitor chooses **Share changes with Amy**.
3. **Hermes Visual Composer:** allow the backend-only Hermes worker to propose validated, allowlisted canvas-shape patches. This role receives no email, CRM, browsing, memory, or general tool authority.
4. **Presentation workflow:** organize approved canvas frames into presentation pages, support SVG/PNG export, and later evaluate reviewed PPTX generation or read-only slide presentation during a live session.

Security gates include authenticated sessions, short-lived document access, version history, script and external-embed blocking, allowlisted shapes and actions, and treating all canvas text as untrusted input. Production use also requires confirming tldraw licensing and persistence architecture.

## Future roadmap: post-session pursuit package

Status: viable after the current three-email workflow is stable.

1. **Hermes-generated attachments:** create a reviewed post-session package containing live notes, the session brief, the roadmap, and allowlisted visual artifacts such as workflows and Mermaid diagrams. Generate from the finalized transcript and canonical workbench model, never a partial live transcript.
2. **Attachment formats:** begin with accessible HTML and PDF; add SVG/PNG diagrams and reviewed PPTX only after the visual-composer and export gates are proven.
3. **Matched case studies:** retrieve only approved Insight case studies from a curated internal library using verified opportunity attributes. Include source, industry, solution lane, and applicability notes so the team receives a defensible go-to-market starting point instead of an invented comparison.
4. **Human review and release:** Hermes may draft and rank the package, but attachments and case-study recommendations remain internal until an authorized reviewer approves them for the Sales and Operations email.

Required safeguards include document provenance, attachment size and type allowlists, contact-data redaction, prompt-injection isolation, malware scanning, deterministic filenames, versioned approvals, and a complete outbound audit receipt.

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
