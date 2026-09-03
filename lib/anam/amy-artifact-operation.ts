import { hasAmySoftCloseIntent, hasExplicitAmyCloseIntent, hasAmyWorkbenchCloseIntent } from './amy-session-close.ts';
import type { AmyWorkbenchView } from './workbench-v2.ts';

export type AmyArtifactView = Exclude<AmyWorkbenchView, 'capabilities' | 'catalog'>;

// Only navigates a read-only working view. Never dispatches email, memory, meetings,
// live search, or other agent tools. An assistant offer alone is not authorization.
export function requestedAmyArtifact(userTurn: string, priorAgentTurn = '', openView?: AmyArtifactView): AmyArtifactView | null {
    const text = userTurn.replace(/[’‘]/g, "'").trim();
    if (hasExplicitAmyCloseIntent(text) || hasAmySoftCloseIntent(text) || hasAmyWorkbenchCloseIntent(text, true)
        || /\b(?:end (?:the )?(?:call|session)|goodbye|take care)\b/i.test(text)
        || /\b(?:don't|do not|not yet|cancel|never mind|no thanks|instead|if|hypothetical)\b/i.test(text)
        || /\b(?:email|e-mail|part number|SKU|inventory|price|pricing|catalog|case study|customer example|capabilities)\b/i.test(text)
        || /\b(?:send|forward)\b.{0,60}\b(?:email|e-mail|recap|summary|materials?|notes?)\b/i.test(text)) return null;
    const viewFrom = (value: string): AmyArtifactView | null =>
        /\blive notes\b/i.test(value) ? 'notes'
        : /\b(?:live|session) briefs?\b/i.test(value) ? 'brief'
        : /\broad\s?map\b/i.test(value) ? 'roadmap'
        : /\b(?:visuals?|briefs?|diagrams?|presentations?)\b/i.test(value) ? 'visual' : null;
    if (/\b(?:show|open|display|create|build|update|refresh|revise|add|include|put together|set|change|replace|adjust|move)\b/i.test(text)) return viewFrom(text)
        ?? (/\b(?:update|refresh|revise|add|include|set|change|replace|adjust|move)\b/i.test(text) ? openView ?? null : null)
        ?? (/\bshow\b.{0,100}\bwhat (?:that|the|a) .{0,45}\bwould look like\b/i.test(text) && /\bworking brief\b/i.test(priorAgentTurn) ? 'visual' : null);
    if (/^(?:yes|sure|please do|go ahead|that (?:would be|sounds) (?:perfect|great|good|helpful))\b/i.test(text)
        && /\b(?:I can|would it help|shall I|want me to)\b.{0,140}\b(?:brief|roadmap|visual|diagram|presentation|live notes)\b/i.test(priorAgentTurn)) return viewFrom(priorAgentTurn);
    return null;
}

export type AmyArtifactResult<T> = { status: 'completed'; value: T } | { status: 'failed' | 'cancelled' };

// Session-local, one in-flight operation. Auto-opening and the provider tool use
// the same key, so they cannot race into duplicate revisions. No automatic retry.
export function createAmyArtifactOperation<T>(options: {
    timeoutMs?: number;
    onPending?: (pending: boolean) => void;
} = {}) {
    let active: { key: string; promise: Promise<AmyArtifactResult<T>>; cancel: () => void } | null = null;
    let previous: { key: string; result: AmyArtifactResult<T> } | null = null;
    return {
        snapshot: () => active ? { status: 'pending' as const, promise: active.promise } : previous?.result ?? null,
        cancel: () => { active?.cancel(); previous = null; },
        run(key: string, operation: (isCurrent: () => boolean) => Promise<T>): Promise<AmyArtifactResult<T>> {
            if (active?.key === key) return active.promise;
            if (previous?.key === key) return Promise.resolve(previous.result);
            active?.cancel();
            let settled = false;
            let finish!: (result: AmyArtifactResult<T>) => void;
            const promise = new Promise<AmyArtifactResult<T>>(resolve => { finish = resolve; });
            const settle = (result: AmyArtifactResult<T>) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                previous = { key, result };
                active = null;
                options.onPending?.(false);
                finish(result);
            };
            const timer = setTimeout(() => settle({ status: 'failed' }), options.timeoutMs ?? 6_000);
            active = { key, promise, cancel: () => settle({ status: 'cancelled' }) };
            options.onPending?.(true);
            void Promise.resolve().then(() => operation(() => !settled))
                .then(value => settle({ status: 'completed', value }), () => settle({ status: 'failed' }));
            return promise;
        },
    };
}
