import type {
    DaniAnamApprovedMemoryRecord,
    DaniAnamBrowserIdentity,
} from './dani-user-memory.ts';
import {
    buildDaniAnamReturningMemoryContext,
    sanitizeDaniAnamMemoryDisplayName,
} from './dani-user-memory.ts';

export type DaniAnamLiveIdentityVerification = {
    preferredName: string;
    memoryContext: string;
    memoryCount: number;
};

export function verifyDaniAnamLiveIdentity(input: {
    preferredName: unknown;
    memoryAccessConfirmed: unknown;
    browserIdentity: DaniAnamBrowserIdentity;
    approvedHistory: DaniAnamApprovedMemoryRecord[];
}): DaniAnamLiveIdentityVerification | null {
    const preferredName = sanitizeDaniAnamMemoryDisplayName(input.preferredName);
    if (!preferredName || /^(?:user|visitor|guest|customer)$/i.test(preferredName)) {
        throw new Error('A valid preferred name is required');
    }
    if (input.memoryAccessConfirmed !== true || input.browserIdentity.memoryConsent !== true) {
        return null;
    }
    return {
        preferredName,
        memoryContext: buildDaniAnamReturningMemoryContext(input.approvedHistory),
        memoryCount: input.approvedHistory.length,
    };
}
