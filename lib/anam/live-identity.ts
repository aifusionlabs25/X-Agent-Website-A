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

const MIN_SPELLED_EMAIL_GROUPS = 4;

function collapseSpelledEmailLabel(value: string): string {
    const groups = value.split(/[-\s]+/).filter(Boolean);
    if (
        groups.length >= MIN_SPELLED_EMAIL_GROUPS
        && groups.every((group) => /^[a-z0-9]$/i.test(group))
    ) {
        return groups.join('');
    }
    return value;
}

function buildLiveEmailCandidates(value: unknown): string[] {
    if (typeof value !== 'string') {
        throw new Error('A valid email is required');
    }

    const prepared = value
        .normalize('NFKC')
        .trim()
        .toLowerCase()
        .replace(/\s*@\s*/g, '@')
        .replace(/\s*\.\s*/g, '.');
    const candidates: string[] = [];

    try {
        candidates.push(normalizeAmyAnamMemoryEmail(prepared));
    } catch {
        // A voice-spelled address can be invalid until its single-letter groups are collapsed.
    }

    const parts = prepared.split('@');
    if (parts.length === 2) {
        const localPart = collapseSpelledEmailLabel(parts[0]);
        const domainPart = parts[1]
            .split('.')
            .map(collapseSpelledEmailLabel)
            .join('.');
        try {
            const spokenCandidate = normalizeAmyAnamMemoryEmail(`${localPart}@${domainPart}`);
            if (!candidates.includes(spokenCandidate)) {
                candidates.push(spokenCandidate);
            }
        } catch {
            // The shared email validator reports the final error below when no candidate is usable.
        }
    }

    if (candidates.length === 0) {
        throw new Error('A valid email is required');
    }
    return candidates;
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

    const emailCandidates = buildLiveEmailCandidates(input.email);
    if (!input.browserIdentity.memoryConsent || !input.browserIdentity.emailIdentityHash) {
        return null;
    }

    const expectedHash = input.browserIdentity.emailIdentityHash;
    const normalizedEmail = emailCandidates.find((candidate) => {
        const candidateHash = deriveAmyAnamEmailIdentityHash(candidate, input.identitySalt);
        return identityHashesMatch(candidateHash, expectedHash);
    });
    if (!normalizedEmail) {
        return null;
    }

    return {
        preferredName,
        normalizedEmail,
        memoryContext: buildAmyAnamReturningMemoryContext(input.approvedHistory),
        memoryCount: input.approvedHistory.length,
    };
}
