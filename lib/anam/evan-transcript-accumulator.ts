export type EvanTranscriptRole = 'user' | 'persona';

export type EvanTranscriptStreamEvent = {
    id: string;
    role: string;
    content: string;
    endOfSpeech?: boolean;
    interrupted?: boolean;
};

export type EvanTranscriptPending = {
    id: string;
    role: EvanTranscriptRole;
    content: string;
    interrupted: boolean;
};

export type EvanTranscriptCompleted = EvanTranscriptPending & {
    completion: 'explicit-final' | 'message-boundary' | 'tool-boundary';
};

export type EvanTranscriptUpdate = {
    completed: EvanTranscriptCompleted[];
    pending: EvanTranscriptPending | null;
    replay: boolean;
};

/**
 * Evan-only transcript assembly. A new message ID/role is a real stream boundary,
 * even if the preceding message did not carry endOfSpeech. No timer, fabricated
 * speech, model instruction, or inferred silence is used to complete a turn.
 * A caller may also finalize a pending user message at an observed model-tool
 * boundary, after independently checking VAD and tool correlation freshness.
 *
 * SDK 4.20 appends persona chunks by ID but adds each user event directly to its
 * history. Accept user deltas and cumulative user snapshots; persona chunks stay
 * strict deltas, including repeated words. The public SDK omits content_index,
 * so arbitrary replayed in-flight chunks cannot safely be distinguished from
 * genuine repeated speech. Only identifiable completed-final replays are ignored.
 */
export function createEvanTranscriptAccumulator() {
    let pending: EvanTranscriptPending | null = null;
    let lastPayload = '';
    const completedMessages = new Map<string, { content: string; lastPayload: string }>();
    const keyFor = (id: string, role: EvanTranscriptRole) => `${role}\u0000${id}`;
    const snapshot = (): EvanTranscriptPending | null => pending ? { ...pending } : null;

    const complete = (completion: EvanTranscriptCompleted['completion']): EvanTranscriptCompleted | null => {
        const current = pending;
        pending = null;
        if (!current?.content.trim()) {
            lastPayload = '';
            return null;
        }
        const result: EvanTranscriptCompleted = { ...current, content: current.content.trim(), completion };
        const key = keyFor(current.id, current.role);
        completedMessages.delete(key);
        completedMessages.set(key, { content: result.content, lastPayload: lastPayload.trim() });
        // Bound replay memory without retaining a second complete session transcript.
        if (completedMessages.size > 128) {
            const oldestKey = completedMessages.keys().next().value;
            if (oldestKey !== undefined) completedMessages.delete(oldestKey);
        }
        lastPayload = '';
        return result;
    };

    return {
        push(event: EvanTranscriptStreamEvent): EvanTranscriptUpdate {
            const completed: EvanTranscriptCompleted[] = [];
            if (!event || typeof event.id !== 'string' || !event.id.trim()
                || (event.role !== 'user' && event.role !== 'persona') || typeof event.content !== 'string') {
                return { completed, pending: snapshot(), replay: false };
            }
            const role = event.role;
            const samePending = pending?.id === event.id && pending.role === role;
            const previous = completedMessages.get(keyFor(event.id, role));
            // Check before switching IDs so an old duplicate final cannot flush a
            // newer in-progress turn. Fresh text under a reused persona ID remains
            // valid (for example, speech resumed after a client tool result).
            if (event.endOfSpeech && !samePending && previous) {
                const text = event.content.trim();
                if (!text || text === previous.content || text === previous.lastPayload) {
                    return { completed, pending: snapshot(), replay: true };
                }
            }
            if (pending && !samePending) {
                const boundaryTurn = complete('message-boundary');
                if (boundaryTurn) completed.push(boundaryTurn);
            }
            if (!pending) {
                pending = { id: event.id, role, content: '', interrupted: false };
            }
            pending.interrupted ||= event.interrupted === true;
            if (event.content) {
                if (role === 'user' && pending.content && event.content.startsWith(pending.content)) {
                    // Same-ID cumulative snapshot (including an identical final).
                    pending.content = event.content;
                } else {
                    pending.content += event.content;
                }
                lastPayload = event.content;
            }
            if (event.endOfSpeech) {
                const finalTurn = complete('explicit-final');
                if (finalTurn) completed.push(finalTurn);
            }
            return { completed, pending: snapshot(), replay: false };
        },
        finalizeUserAtToolBoundary(): EvanTranscriptCompleted | null {
            // A tool boundary does not establish that persona speech has finished.
            // The player owns VAD/correlation authorization before invoking this.
            return pending?.role === 'user' ? complete('tool-boundary') : null;
        },
        getPending: snapshot,
        reset() {
            pending = null;
            lastPayload = '';
            completedMessages.clear();
        },
    };
}
