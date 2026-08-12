import {
    createFarewellCloseCoordinator,
} from './farewell-close-coordinator.ts';
import type { FarewellCloseCoordinator } from './farewell-close-coordinator.ts';

export type AmyFarewellCloseCoordinator = FarewellCloseCoordinator;
export const createAmyFarewellCloseCoordinator = createFarewellCloseCoordinator;

const EXPLICIT_AMY_CLOSE_INTENT = /\b(?:goodbye|good[ -]?bye|bye(?:\s+amy)?|take\s+care|good\s*night|have\s+a\s+good\s+(?:day|evening|night)|(?:end|close|stop|finish)\s+(?:the\s+|this\s+|our\s+)?(?:call|conversation|session)|(?:hang|sign)\s+off|i\s+(?:have|need|got)\s+to\s+go|i(?:'m| am)\s+(?:done|finished)|we(?:'re| are)\s+finished)\b/i;

const AMY_SOFT_CLOSE_INTENT = /\b(?:(?:let'?s|we can|we should)\s+(?:call it a day|wrap\s+(?:(?:it|this)\s+)?(?:up|here)|wrap\s+here)|(?:we(?:'re| are)|i(?:'m| am))\s+(?:all\s+set|good)(?:\s+for\s+(?:now|today))?|that(?:'s| is)\s+(?:all|everything|it)|nothing\s+else|wrap\s+(?:it|this)\s+here|we can move to (?:the )?close)\b/i;

export function hasExplicitAmyCloseIntent(value: string): boolean {
    return EXPLICIT_AMY_CLOSE_INTENT.test(String(value ?? ''));
}

export function hasAmySoftCloseIntent(value: string): boolean {
    return AMY_SOFT_CLOSE_INTENT.test(String(value ?? ''));
}
