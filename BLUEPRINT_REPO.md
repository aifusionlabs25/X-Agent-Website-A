# X Agents Repository Blueprint

**Project:** X Agents Showcase Platform  
**Architecture:** Next.js 15 (App Router), React 19, Tailwind CSS  
**Core AI Engine:** Anam.ai (Live Interactive Video Agents)

This repository (`x-agent-website-a`) acts as a **multitenant showcase platform** that hosts all X Agents under a single application infrastructure.

---

## 🏗️ 1. Core Philosophy

Unlike legacy iterations where each agent had its own standalone codebase (e.g., `dani-x-agent`, `james-knowles-agent`), this repository centralizes the infrastructure. 

### Why the Change?
1. **Single Point of Deployment:** Fix a bug once (e.g., in the Anam player logic) and it applies to every agent simultaneously.
2. **Dynamic Routing:** Agents are not hardcoded separate pages; they are dynamically generated from a central configuration file based on their `slug`.
3. **Cross-Pollination:** Users can browse multiple agents on the same site without switching domains, acting as a true "Showcase."

---

## 📂 2. Folder Structure & Pathing

### `/app` (The Next.js App Router)
- `page.tsx` - The cinematic landing page featuring the Hero Billboard, dynamic Agent Carousel, and global value props.
- `layout.tsx` - The global HTML shell, integrating fonts (Google Fonts) and shared metadata.
- `/agents/[slug]/page.tsx` - The **Dynamic Detailing Page** for a specific agent. Extracts the `slug` from the URL, looks up the agent's stats/prompt config in `lib/agents.ts`, and renders a dedicated landing page for that persona.
- `/demo/[slug]/page.tsx` - The **Live Interactive Route**. This takes over the full viewport, removes standard navigation, and mounts the `AnamPlayer` connected to the specific agent's `personaId`.
- `/api/anam-token/route.ts` - **CRITICAL SECURITY PROXY**. The browser client MUST NOT hold the raw `ANAM_API_KEY`. This route securely exchanges the API key for a short-lived `sessionToken` that the browser uses to connect.
- `/api/save-transcript/route.ts` - Endpoint that receives the conversational transcript (when an Anam session closes) and saves it to disk (or future database).

### `/components` (Reusable UI Elements)
- `/home/HeroBillboard.tsx` - The top video section of the homepage. Uses a custom state machine to conditionally mount the live Dani Anam session directly OVER the hero image when clicked.
- `/home/AgentCarousel.tsx` - The horizontal scrolling list of agents powered by `lib/agents.ts`.
- `/layout/SiteHeader.tsx` & `/layout/SiteFooter.tsx` - Global navigation and footer links.
- `AnamPlayer.tsx` - **The Engine Room**. This component wraps the `@anam-ai/js-sdk`. It takes a `personaId`, requests a session token from `/api/anam-token`, mounts the WebRTC video stream, captures transcript chunks via event listeners, and handles graceful connection closures.

### `/lib` (Business Logic & Configuration)
- `agents.ts` - **The Single Source of Truth**. This array exports `ALL_AGENTS`. Every agent's name, role, system prompt display, `personaId` for Anam, and thumbnail image is defined here. Adding a new agent to the site is as simple as adding an object to this array.

### `/public` (Static Assets)
- `/agents/thumbnails/` - Houses the high-res static imagery for carousels and hero sections.
- `/transcripts/` - Local filesystem storage where `/api/save-transcript` currently writes the `.json` output of completed sessions (placeholder for future CRM webhook integration).

---

## 🛠️ 3. How to Add a New Agent

1. **Upload Assets:** Drop the agent's thumbnail image into `public/agents/thumbnails/`.
2. **Configure Anam:** Obtain the new `personaId` from your Anam.ai dashboard.
3. **Update Registry:** Open `lib/agents.ts` and add a new block to the `ALL_AGENTS` array:
```typescript
{
    slug: 'new-agent-slug',
    name: 'AGENT NAME',
    role: 'Agent Role',
    personaId: 'your-anam-persona-id-here',
    thumbnailSrc: '/agents/thumbnails/your-image.jpg',
    accentColor: '#hexcode',
    liveUrl: '/demo/new-agent-slug',
}
```
4. **Deploy:** Commit and push. Next.js will automatically generate the `/agents/new-agent-slug` and `/demo/new-agent-slug` routes.

---

## 🔒 4. Environment Variables (`.env.local`)

| Variable | Description |
| :--- | :--- |
| `ANAM_API_KEY` | Used by `/api/anam-token` to authenticate with Anam's backend. Do not expose client-side. |
| `ANAM_AMY_CARA4_PERSONA_ID` | Preview-only server-side ID for Amy's stable Cara 4 canary. When absent, the canary route fails closed and public Amy remains unchanged. |

---

## ⚙️ 5. Next Steps / Future Enhancements
- **Multi-tenant CRM Integration:** Expand `/api/save-transcript` to selectively fire webhooks to different CRMs (HubSpot, GoHighLevel) based on which agent `slug` generated the transcript.
- **Analytics:** Wire the application router to capture session depths across different agent profiles.
