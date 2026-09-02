import {
    createFarewellCloseCoordinator,
} from './farewell-close-coordinator.ts';
import type { FarewellCloseCoordinator } from './farewell-close-coordinator.ts';

export type AmyFarewellCloseCoordinator = FarewellCloseCoordinator;
export const createAmyFarewellCloseCoordinator = createFarewellCloseCoordinator;

// Only the visitor's complete final spoken clause may authorize a close. This
// keeps quoted, hypothetical, interrogative, and in-progress business language
// from arming the browser close coordinator.
const AMY_POLITE_CLOSE_PREFIX = '(?:(?:okay|ok|all\\s+right|well|sorry|thanks(?:\\s+amy)?|thank\\s+you(?:\\s+amy)?)[,\\s]+)?';
const EXPLICIT_AMY_CLOSE_INTENT = new RegExp(
    `^${AMY_POLITE_CLOSE_PREFIX}(?:(?:good[ -]?bye|bye(?:\\s+amy)?|take\\s+care(?:\\s*,?\\s*amy)?|good\\s*night(?:\\s*,?\\s*amy)?|have\\s+a\\s+good\\s+(?:day|evening|night)|(?:talk|speak)\\s+to\\s+you\\s+later|see\\s+you\\s+later)|(?:please[,\\s]+)?(?:end|close|stop|finish)\\s+(?:the\\s+|this\\s+|our\\s+)?(?:call|conversation|session)(?:\\s+(?:now|please))?|(?:(?:let'?s|we\\s+should)|i(?:'d| would)\\s+like\\s+to|i\\s+want\\s+to)\\s+(?:end|close|stop|finish)\\s+(?:the\\s+|this\\s+|our\\s+)?(?:call|conversation|session)|let'?s\\s+end\\s+here|(?:let'?s|we\\s+(?:can|should)|i(?:'m| am)(?:\\s+going\\s+to)?|i\\s+(?:have|need|got)\\s+to)\\s+sign\\s+off(?:\\s+(?:now|for\\s+(?:now|today)))?|hang\\s+up|i\\s+(?:have|need|got)\\s+to\\s+(?:go|leave|run)(?:\\s+(?:now|for\\s+(?:now|today)))?|i\\s+should\\s+get\\s+going(?:\\s+now)?|(?:i(?:'ve| have)\\s+)?gotta\\s+go(?:\\s+now)?|i(?:'m| am)\\s+(?:done|finished)(?:\\s+(?:here|for\\s+(?:now|today)))?|we(?:'re| are)\\s+(?:done|finished)(?:\\s+(?:here|for\\s+(?:now|today)))?|that(?:'s| is)\\s+a\\s+wrap(?:\\s+on\\s+(?:the\\s+)?role[ -]?play)?|(?:the\\s+)?role[ -]?play\\s+(?:is\\s+)?(?:over|finished|done))(?:\\s*,?\\s*(?:please|amy|thanks(?:\\s+amy)?|thank\\s+you(?:\\s+amy)?))?[.!?\\s]*$`,
    'i',
);
const AMY_DIRECT_CLOSE_REQUEST = /^(?:(?:can|could|would)\s+(?:you|we)\s+(?:please\s+)?(?:end|close|stop)\s+(?:the\s+|this\s+|our\s+)?(?:call|conversation|session)(?:\s+now)?(?:\s+please)?|would\s+you\s+mind\s+(?:ending|closing|stopping)\s+(?:the\s+|this\s+|our\s+)?(?:call|conversation|session))\s*\?$/i;
const AMY_TERMINAL_CLOSE_DISCUSSION = /^(?:what|why|how|when|where|who|do|does|did|is|are|can|could|would|should|will)\b|\b(?:if\s+i\s+say|what\s+if|the\s+question\s+is|whether|(?:say|says|said|saying)\s+(?:good[ -]?bye|bye|take\s+care))\b/i;
const AMY_TERMINAL_HARD_CLOSE_SUFFIX = /\b(?:(?:good[ -]?bye|bye)(?:\s*,?\s*amy)?|take\s+care(?:\s*,?\s*amy)?|i\s+(?:have|need|got)\s+to\s+(?:go|leave|run)(?:\s+(?:now|for\s+(?:now|today)))?|i\s+should\s+get\s+going(?:\s+now)?|(?:i(?:'ve| have)\s+)?gotta\s+go(?:\s+now)?|i(?:'m| am)\s+going\s+to\s+(?:jump|hop)\s+off(?:\s+now)?)\s*[.!\s]*$/i;

const AMY_SOFT_CLOSE_INTENT = new RegExp(
    `^${AMY_POLITE_CLOSE_PREFIX}(?:(?:let'?s|we\\s+(?:can|should))\\s+(?:call\\s+it\\s+a\\s+day|wrap\\s+(?:(?:it|this)\\s+)?(?:up|here)|wrap\\s+here)|(?:we(?:'re| are)|i(?:'m| am))\\s+(?:all\\s+set|good)(?:\\s+for\\s+(?:now|today))?|that(?:'s| is)\\s+(?:all|everything|it)|nothing\\s+else|wrap\\s+(?:it|this)\\s+here|we\\s+can\\s+move\\s+to\\s+(?:the\\s+)?close|thanks?\\s+for\\s+(?:your|the)\\s+time(?:\\s+today)?|i(?:'ve| have)\\s+got\\s+what\\s+i\\s+need|we(?:'ll| will)\\s+talk\\s+next\\s+steps)(?:\\s*,?\\s*(?:please|amy|thanks(?:\\s+amy)?|thank\\s+you(?:\\s+amy)?))?[.!\\s]*$`,
    'i',
);
const AMY_TERMINAL_SOFT_CLOSE_SUFFIX = /\b(?:(?:we(?:'re| are)|i(?:'m| am))\s+all\s+set(?:\s+for\s+(?:now|today))?|(?:i\s+think\s+)?that(?:'s| is)\s+(?:all|it)(?:\s+for\s+me)?)(?:\s*,?\s*(?:thanks(?:\s+amy)?|thank\s+you(?:\s+amy)?))?\s*[.!\s]*$/i;
const AMY_PENDING_REQUEST = /\bbefore\s+(?:we|i)\s+(?:wrap|finish|end|close|stop)(?:\s+(?:it|this|the\s+(?:call|conversation|session)))?\b[\s\S]{0,180}\b(?:can|could|would|will|show|tell|explain|help|what|how|why)\b/i;
const AMY_NEGATED_SESSION_CLOSE_INTENT = /\b(?:do\s+not|don'?t|never|should\s+not|shouldn'?t|cannot|can'?t)\s+(?:please\s+)?(?:end|close|stop|finish)\s+(?:the\s+|this\s+|our\s+)?(?:call|conversation|session)\b/i;
const AMY_NAMED_WORKBENCH_CLOSE_INTENT = /\b(?:close|hide|dismiss|minimi[sz]e|put\s+away)\b[\s\S]{0,80}\b(?:amy\s+intelligence|insight\s+intelligence(?:\s+layer)?|visual(?:\s+brief)?|live\s+brief|brief|notes?|roadmap|catalog)\b|\b(?:amy\s+intelligence|insight\s+intelligence(?:\s+layer)?|visual(?:\s+brief)?|live\s+brief|brief|notes?|roadmap|catalog)\b[\s\S]{0,80}\b(?:close|hide|dismiss|minimi[sz]e|put\s+away)\b/i;
const AMY_GENERIC_WORKBENCH_CLOSE_INTENT = /\b(?:close|hide|dismiss|minimi[sz]e|put\s+away)\b[\s\S]{0,80}\b(?:panel|window|view|screen|pop(?:ped)?[ -]?up)\b|\b(?:panel|window|view|screen|pop(?:ped)?[ -]?up)\b[\s\S]{0,80}\b(?:close|hide|dismiss|minimi[sz]e|put\s+away)\b/i;
const AMY_AMBIGUOUS_VIEW_CLOSE_INTENT = /\b(?:close|hide|dismiss|minimi[sz]e|put\s+away)\s+(?:this|that|it)(?:\s+(?:now|please))?\b|\byou\s+can\s+close\s+(?:this|that|it)(?:\s+now)?\b/i;

const AMY_DIRECT_EMAIL_REQUEST = /\b(?:email|e-?mail|send|share|forward)\b.{0,80}\b(?:me|my|recap|summary|brief|visual|follow[- ]?up|materials?|notes?)\b|\b(?:recap|summary|brief|visual|follow[- ]?up|materials?|notes?)\b.{0,80}\b(?:email|e-?mail|send|share|forward)\b/i;
const AMY_EMAIL_OFFER = /\b(?:would|do)\s+you\s+(?:like|want)\b.{0,100}\b(?:email|e-?mail|send)\b|\b(?:email|e-?mail)\b.{0,100}\b(?:private\s+check[- ]?in|recap|summary|visual\s+brief)\b/i;
const AMY_AFFIRMATIVE_REPLY = /^(?:yes|yeah|yep|sure|okay|ok|please|please do|that works|sounds good|go ahead|absolutely|definitely|i would|i'd like that|send it)(?:[,!?.\s].*)?$/i;
const AMY_NEGATIVE_REPLY = /^(?:no|nope|not\s+(?:now|today|necessary)|don'?t|do\s+not|skip|decline|rather\s+not)\b/i;

function finalSpokenClause(value: string): string {
    const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
    return normalized.split(/[.!?]\s+/).at(-1)?.trim() ?? '';
}

const POLITE_FAREWELL = /^(?:(?:okay|ok|thanks|thank you)[,\s]+)?(?:have (?:a |an )?(?:good|great|nice|wonderful|lovely) (?:day|evening|night|weekend)|enjoy (?:your|the) (?:day|evening|weekend))(?:[,\s]+(?:amy|thanks|thank you|too|you too))?[.!\s]*$/i;

export function hasExplicitAmyCloseIntent(value: string): boolean {
    const normalized = String(value ?? '').trim();
    const finalClause = finalSpokenClause(normalized);
    if (!normalized || AMY_PENDING_REQUEST.test(normalized) || AMY_NEGATED_SESSION_CLOSE_INTENT.test(normalized)) {
        return false;
    }
    if (EXPLICIT_AMY_CLOSE_INTENT.test(finalClause) || AMY_DIRECT_CLOSE_REQUEST.test(finalClause) || POLITE_FAREWELL.test(finalClause)) return true;
    return !AMY_TERMINAL_CLOSE_DISCUSSION.test(finalClause)
        && AMY_TERMINAL_HARD_CLOSE_SUFFIX.test(finalClause);
}

export function hasAmySoftCloseIntent(value: string): boolean {
    const normalized = String(value ?? '').trim();
    const finalClause = finalSpokenClause(normalized);
    if (!normalized || AMY_PENDING_REQUEST.test(normalized) || AMY_TERMINAL_CLOSE_DISCUSSION.test(finalClause)) {
        return false;
    }
    return AMY_SOFT_CLOSE_INTENT.test(finalClause)
        || AMY_TERMINAL_SOFT_CLOSE_SUFFIX.test(finalClause);
}

export function hasAmyWorkbenchCloseIntent(value: string, workbenchIsOpen = false): boolean {
    const normalized = String(value ?? '');
    if (!normalized || hasExplicitAmyCloseIntent(normalized)) return false;
    return AMY_NAMED_WORKBENCH_CLOSE_INTENT.test(normalized)
        || (workbenchIsOpen && (
            AMY_GENERIC_WORKBENCH_CLOSE_INTENT.test(normalized)
            || AMY_AMBIGUOUS_VIEW_CLOSE_INTENT.test(normalized)
        ));
}

export function hasAmyEmailOffer(value: string): boolean {
    return AMY_EMAIL_OFFER.test(String(value ?? ''));
}

export function hasAmyEmailPermission(userTurn: string, previousAgentTurn = ''): boolean {
    const normalizedUserTurn = String(userTurn ?? '').trim();
    if (!normalizedUserTurn || AMY_NEGATIVE_REPLY.test(normalizedUserTurn)) return false;
    if (AMY_DIRECT_EMAIL_REQUEST.test(normalizedUserTurn)) return true;
    return hasAmyEmailOffer(previousAgentTurn) && AMY_AFFIRMATIVE_REPLY.test(normalizedUserTurn);
}
