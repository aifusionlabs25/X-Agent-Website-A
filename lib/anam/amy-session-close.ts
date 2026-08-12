import {
    createFarewellCloseCoordinator,
} from './farewell-close-coordinator.ts';
import type { FarewellCloseCoordinator } from './farewell-close-coordinator.ts';

export type AmyFarewellCloseCoordinator = FarewellCloseCoordinator;
export const createAmyFarewellCloseCoordinator = createFarewellCloseCoordinator;

const EXPLICIT_AMY_CLOSE_INTENT = /\b(?:(?:let'?s|we can|we should)\s+(?:call it a day|wrap\s+(?:it\s+)?up)|(?:end|close|stop)\s+(?:the\s+|this\s+|our\s+)?(?:call|conversation|session)|i(?:'m| am)\s+done|that(?:'s| is)\s+all|goodbye|take\s+care)\b/i;

export function hasExplicitAmyCloseIntent(value: string): boolean {
    return EXPLICIT_AMY_CLOSE_INTENT.test(String(value ?? ''));
}
