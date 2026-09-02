import { hasExplicitAmyCloseIntent, hasAmySoftCloseIntent } from './amy-session-close.ts';
import { buildAmyWorkbenchModel, diffAmyWorkbenchFacts } from './workbench-v2.ts';
import type { AmyWorkbenchModel, AmyWorkbenchTurn, AmyWorkbenchView } from './workbench-v2.ts';

const VIEW_TOOL = {
    notes: 'show_live_notes', brief: 'show_session_brief', roadmap: 'show_solution_roadmap',
    visual: 'show_visual_brief', catalog: 'show_solution_catalog',
} as const;

// Fixed policy text only: no raw visitor text is promoted into runtime instructions.
export function amyDiscoveryTurnGuidance(input: {
    userTurn: string;
    turns: AmyWorkbenchTurn[];
    view: AmyWorkbenchView;
    isOpen: boolean;
    lastReceipt: AmyWorkbenchModel | null;
}): string | null {
    if (hasExplicitAmyCloseIntent(input.userTurn) || hasAmySoftCloseIntent(input.userTurn)) return null;
    if (/\b(?:email|e-mail|send|forward)\b.{0,85}\b(?:summary|recap|brief|roadmap|notes|it)\b/i.test(input.userTurn)) {
        return 'The visitor requested delivery, not the end of the conversation. The standard follow-up is already included through private check-in. Acknowledge that once, without a tool call, address confirmation, closing question, or goodbye. Do not call end_amy_session unless the visitor separately expresses closing intent.';
    }
    if (!input.isOpen || input.view === 'capabilities' || !input.lastReceipt) return null;
    const next = buildAmyWorkbenchModel(input.turns, '', '', input.view);
    if (!diffAmyWorkbenchFacts(input.lastReceipt, next).length) return null;
    return `The visitor supplied new supported context while a working view is open. Before claiming anything was added or updated, call ${VIEW_TOOL[input.view]} once and check its appliedChanges and visibleFacts. Acknowledge only the exact confirmed delta in one sentence. Recording an unresolved funding or compliance question is permitted discovery, not approval or specialist advice. A target date is not a booking or validated feasibility; requirements to clarify are not confirmed constraints. If the tool does not confirm the change, do not claim it landed.`;
}
