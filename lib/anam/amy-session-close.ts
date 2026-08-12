import {
    createFarewellCloseCoordinator,
} from './farewell-close-coordinator.ts';
import type { FarewellCloseCoordinator } from './farewell-close-coordinator.ts';

export type AmyFarewellCloseCoordinator = FarewellCloseCoordinator;
export const createAmyFarewellCloseCoordinator = createFarewellCloseCoordinator;

const EXPLICIT_AMY_CLOSE_INTENT = /\b(?:goodbye|good[ -]?bye|bye(?:\s+amy)?|take\s+care|good\s*night|have\s+a\s+good\s+(?:day|evening|night)|(?:end|close|stop|finish)\s+(?:the\s+|this\s+|our\s+)?(?:call|conversation|session)|(?:hang|sign)\s+off|i\s+(?:have|need|got)\s+to\s+go|i(?:'m| am)\s+(?:done|finished)|we(?:'re| are)\s+finished)\b/i;

const AMY_SOFT_CLOSE_INTENT = /\b(?:(?:let'?s|we can|we should)\s+(?:call it a day|wrap\s+(?:(?:it|this)\s+)?(?:up|here)|wrap\s+here)|(?:we(?:'re| are)|i(?:'m| am))\s+(?:all\s+set|good)(?:\s+for\s+(?:now|today))?|that(?:'s| is)\s+(?:all|everything|it)|nothing\s+else|wrap\s+(?:it|this)\s+here|we can move to (?:the )?close)\b/i;

const AMY_DIRECT_EMAIL_REQUEST = /\b(?:email|e-?mail|send|share|forward)\b.{0,80}\b(?:me|my|recap|summary|brief|visual|follow[- ]?up|materials?|notes?)\b|\b(?:recap|summary|brief|visual|follow[- ]?up|materials?|notes?)\b.{0,80}\b(?:email|e-?mail|send|share|forward)\b/i;
const AMY_EMAIL_OFFER = /\b(?:would|do)\s+you\s+(?:like|want)\b.{0,100}\b(?:email|e-?mail|send)\b|\b(?:email|e-?mail)\b.{0,100}\b(?:private\s+check[- ]?in|recap|summary|visual\s+brief)\b/i;
const AMY_AFFIRMATIVE_REPLY = /^(?:yes|yeah|yep|sure|okay|ok|please|please do|that works|sounds good|go ahead|absolutely|definitely|i would|i'd like that|send it)(?:[,!?.\s].*)?$/i;
const AMY_NEGATIVE_REPLY = /^(?:no|nope|not\s+(?:now|today|necessary)|don'?t|do\s+not|skip|decline|rather\s+not)\b/i;

export function hasExplicitAmyCloseIntent(value: string): boolean {
    return EXPLICIT_AMY_CLOSE_INTENT.test(String(value ?? ''));
}

export function hasAmySoftCloseIntent(value: string): boolean {
    return AMY_SOFT_CLOSE_INTENT.test(String(value ?? ''));
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
