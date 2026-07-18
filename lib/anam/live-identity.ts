import type { AmyAnamApprovedMemoryRecord, AmyAnamBrowserIdentity } from './user-memory.ts';
import {
    buildAmyAnamReturningMemoryContext,
    sanitizeAmyAnamMemoryDisplayName,
} from './user-memory.ts';

export type AmyAnamLiveIdentityVerification = {
    preferredName: string;
    memoryContext: string;
    memoryCount: number;
};

export function verifyAmyAnamLiveIdentity(input: {
    preferredName: unknown;
    memoryAccessConfirmed: unknown;
    browserIdentity: AmyAnamBrowserIdentity;
    approvedHistory: AmyAnamApprovedMemoryRecord[];
}): AmyAnamLiveIdentityVerification | null {
    const preferredName = sanitizeAmyAnamMemoryDisplayName(input.preferredName);
    if (!preferredName) throw new Error('A valid preferred name is required');

    if (
        input.memoryAccessConfirmed !== true
        || !input.browserIdentity.memoryConsent
        || !input.browserIdentity.emailIdentityHash
    ) {
        return null;
    }

    return {
        preferredName,
        memoryContext: buildAmyAnamReturningMemoryContext(input.approvedHistory),
        memoryCount: input.approvedHistory.length,
    };
}
