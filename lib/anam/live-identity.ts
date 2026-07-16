import { timingSafeEqual } from 'node:crypto';
import type { AmyAnamApprovedMemoryRecord, AmyAnamBrowserIdentity } from './user-memory.ts';
import {
    buildAmyAnamReturningMemoryContext,
    deriveAmyAnamEmailIdentityHash,
    normalizeAmyAnamMemoryEmail,
    sanitizeAmyAnamMemoryDisplayName,
} from './user-memory.ts';

export type AmyAnamLiveIdentityVerification = {
    preferredName: string;
    normalizedEmail: string;
    memoryContext: string;
    memoryCount: number;
};

function identityHashesMatch(candidate: string, expected: string): boolean {
    if (!/^[a-f0-9]{64}$/i.test(candidate) || !/^[a-f0-9]{64}$/i.test(expected)) {
        return false;
    }
    return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(expected, 'hex'));
}

export function verifyAmyAnamLiveIdentity(input: {
    preferredName: unknown;
    email: unknown;
    browserIdentity: AmyAnamBrowserIdentity;
    approvedHistory: AmyAnamApprovedMemoryRecord[];
    identitySalt: string;
}): AmyAnamLiveIdentityVerification | null {
    const preferredName = sanitizeAmyAnamMemoryDisplayName(input.preferredName);
    if (!preferredName) throw new Error('A valid preferred name is required');

    const normalizedEmail = normalizeAmyAnamMemoryEmail(input.email);
    if (!input.browserIdentity.memoryConsent || !input.browserIdentity.emailIdentityHash) {
        return null;
    }

    const candidateHash = deriveAmyAnamEmailIdentityHash(normalizedEmail, input.identitySalt);
    if (!identityHashesMatch(candidateHash, input.browserIdentity.emailIdentityHash)) {
        return null;
    }

    return {
        preferredName,
        normalizedEmail,
        memoryContext: buildAmyAnamReturningMemoryContext(input.approvedHistory),
        memoryCount: input.approvedHistory.length,
    };
}
