import type { AnamSessionMetadata } from '../anam/session-api.ts';
import { isUuid } from '../anam/session-spine.ts';
import type { Session } from './state.ts';

export type JamesBrowserRelease = {
    source: 'PROVIDER_END' | 'EXPIRED_UNSTARTED_LAUNCH' | 'BROWSER_CANCELLED_BEFORE_SDK';
    verifiedAt: string;
    providerId?: string;
    endTime?: string;
};

type RecoverableSession = Pick<Session, 'id' | 'clientLabel' | 'createdAt' | 'personaId' | 'providerId' | 'state'>;
type RecoveryDependencies = {
    providerIdHint?: unknown;
    sdkNeverStarted?: boolean;
    request: (path: string, body?: object) => Promise<any>;
    metadata: (id: string) => Promise<AnamSessionMetadata>;
    nowMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
};
// Anam session tokens last one hour. The extra minute covers the bounded
// token-mint request and clock skew; absence before expiry is not release.
const expiredLaunchAgeMs = 61 * 60 * 1000;
const clockSkewMs = 60 * 1000;
const releasePollDelaysMs = [0, 250, 750, 1250];

function matchingProviderEnd(metadata: AnamSessionMetadata, providerId: string,
    current: RecoverableSession, createdAtMs: number, nowMs: number): string | null {
    const startedAt = typeof metadata.startTime === 'string' ? Date.parse(metadata.startTime) : NaN;
    if (metadata.id !== providerId || metadata.clientLabel !== current.clientLabel
        || (metadata.personaId !== null && metadata.personaId !== current.personaId)
        || !Number.isFinite(startedAt) || startedAt < createdAtMs - clockSkewMs
        || startedAt > createdAtMs + expiredLaunchAgeMs || startedAt > nowMs + clockSkewMs) {
        throw new Error('Provider session does not match this saved James launch');
    }
    if (metadata.endTime === null) return null;
    const endedAt = typeof metadata.endTime === 'string' ? Date.parse(metadata.endTime) : NaN;
    if (!Number.isFinite(endedAt) || endedAt < startedAt || endedAt > nowMs + clockSkewMs)
        throw new Error('Provider session end time is not valid');
    return metadata.endTime;
}

function providerFromCompleteList(payload: unknown, clientLabel: string): string | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw new Error('Provider session lookup is incomplete');
    const { data, meta } = payload as { data?: unknown; meta?: Record<string, unknown> };
    if (!Array.isArray(data) || data.length > 100 || !meta || typeof meta !== 'object' || Array.isArray(meta)
        || !Number.isInteger(meta.total) || meta.total !== data.length || meta.currentPage !== 1
        || !Number.isInteger(meta.lastPage) || (meta.lastPage !== 0 && meta.lastPage !== 1)
        || meta.perPage !== 100 || meta.prev !== null || meta.next !== null) {
        throw new Error('Provider session lookup is incomplete');
    }
    if (data.some(item => !item || typeof item !== 'object' || Array.isArray(item)
        || !isUuid(item.id) || (typeof item.clientLabel !== 'string' && item.clientLabel !== null))) {
        throw new Error('Provider session lookup is invalid');
    }
    const matches = data.filter(item => item.clientLabel === clientLabel);
    if (matches.length > 1) throw new Error('More than one provider session matches this saved James launch');
    return matches.length === 1 ? matches[0].id : null;
}

/** The caller authorizes the stored record's browser before invoking this.
 * Browser cancellation, provider end, and expired unused launches stay distinct.
 * It never edits notes or certifies a final transcript/PAD receipt. */
export async function releaseJamesBrowserSession(current: RecoverableSession,
    dependencies: RecoveryDependencies): Promise<JamesBrowserRelease> {
    const nowMs = dependencies.nowMs ?? Date.now();
    const createdAtMs = Date.parse(current.createdAt);
    if (!isUuid(current.id) || !current.clientLabel || !Number.isFinite(createdAtMs)
        || !Number.isFinite(nowMs) || createdAtMs > nowMs + clockSkewMs) {
        throw new Error('Saved James launch identity is invalid');
    }
    const hint = dependencies.providerIdHint;
    if (hint !== undefined && hint !== null && !isUuid(hint))
        throw new Error('Provider session hint is invalid');
    if (current.providerId !== undefined && !isUuid(current.providerId))
        throw new Error('Saved provider session identifier is invalid');
    if (current.providerId && hint && current.providerId !== hint)
        throw new Error('Provider session hint conflicts with the saved James launch');
    const cancelledBeforeSdk = dependencies.sdkNeverStarted === true;
    if (cancelledBeforeSdk && (current.state !== 'LAUNCHING' || current.providerId || hint))
        throw new Error('Browser cancellation before SDK start is not valid for an identified or connected James call');
    let providerId: string | null = current.providerId ?? (typeof hint === 'string' ? hint : null);
    if (!providerId) {
        const list = await dependencies.request('/sessions?search=' + encodeURIComponent(current.clientLabel)
            + '&page=1&perPage=100');
        providerId = providerFromCompleteList(list, current.clientLabel);
        if (!providerId) {
            // This is the owning browser's settled, never-started SDK attempt,
            // corroborated by a complete empty provider lookup. It does not
            // revoke the minted token or certify a provider termination.
            if (cancelledBeforeSdk)
                return { source: 'BROWSER_CANCELLED_BEFORE_SDK', verifiedAt: new Date(nowMs).toISOString() };
            if (current.state !== 'LAUNCHING' || nowMs - createdAtMs < expiredLaunchAgeMs)
                throw new Error('James launch is still pending; a new call is not yet safe');
            return { source: 'EXPIRED_UNSTARTED_LAUNCH', verifiedAt: new Date(nowMs).toISOString() };
        }
    }
    const observed = await dependencies.metadata(providerId);
    const alreadyEnded = matchingProviderEnd(observed, providerId, current, createdAtMs, nowMs);
    const released = (endTime: string): JamesBrowserRelease => ({
        source: 'PROVIDER_END', providerId, endTime, verifiedAt: new Date(nowMs).toISOString(),
    });
    if (alreadyEnded) return released(alreadyEnded);
    try {
        await dependencies.request('/sessions/' + encodeURIComponent(providerId) + '/stop', {});
    } catch {
        // Neither an accepted stop nor an error (including 404) proves release.
        // A concurrent engine end may still become authoritative in metadata.
    }
    const sleep = dependencies.sleep ?? (milliseconds => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
    for (const delay of releasePollDelaysMs) {
        if (delay) await sleep(delay);
        let metadata: AnamSessionMetadata;
        try { metadata = await dependencies.metadata(providerId); }
        catch { continue; }
        const endTime = matchingProviderEnd(metadata, providerId, current, createdAtMs, nowMs);
        if (endTime) return released(endTime);
    }
    throw new Error('Provider session release is not yet verified; saved James notes are preserved');
}
