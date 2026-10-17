// Local-only SDK replacement. Never opens a provider connection or microphone.
export const AnamEvent = Object.fromEntries([
    'CONNECTION_ESTABLISHED', 'MIC_PERMISSION_DENIED', 'INPUT_AUDIO_STREAM_STARTED',
    'SESSION_READY', 'MESSAGE_STREAM_EVENT_RECEIVED', 'CONNECTION_CLOSED',
    'SERVER_WARNING', 'USER_SPEECH_STARTED', 'USER_SPEECH_ENDED',
    'TOOL_CALL_STARTED', 'TOOL_CALL_COMPLETED', 'TOOL_CALL_FAILED',
].map(name => [name, name]));
export const ConnectionClosedCode = { NORMAL: 'NORMAL' };

export class AnamClient {
    listeners = new Map();
    handlers = new Map();
    talks = [];
    contexts = [];
    ready = false;
    nextToolId = 1;
    stopCount = 0;
    interruptCount = 0;
    addListener(event, listener) {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event).add(listener);
    }
    removeListener(event, listener) { this.listeners.get(event)?.delete(listener); }
    emit(event, payload) { for (const listener of this.listeners.get(event) || []) listener(payload); }
    registerToolCallHandler(name, handler) {
        this.handlers.set(name, handler);
        return () => this.handlers.delete(name);
    }
    async streamToVideoElement(id) {
        const video = document.getElementById(id);
        if (video) video.poster = '/agents/thumbnails/Evan Mullins Moving.png';
        this.emit(AnamEvent.CONNECTION_ESTABLISHED);
        this.emit(AnamEvent.SESSION_READY, 'isolated-ui-fixture-session');
        this.ready = true;
    }
    async stopStreaming() { this.stopCount++; this.ready = false; }
    async talk(text) { this.talks.push(text); }
    addContext(text) { this.contexts.push(text); }
    muteInputAudio() {}
    interruptPersona() { this.interruptCount++; }
    message(message) { this.emit(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, message); }
    async callTool(name, args, metadata = {}) {
        const handler = this.handlers.get(name);
        if (!handler) throw new Error(`Missing mocked tool handler: ${name}`);
        const payload = { id: `fixture-${name}-${this.nextToolId++}`, name, arguments: args, ...metadata };
        const lifecycle = { toolCallId: payload.id, toolName: name };
        this.emit(AnamEvent.TOOL_CALL_STARTED, lifecycle);
        const result = await handler.onStart(payload);
        await handler.onComplete?.(payload);
        this.emit(AnamEvent.TOOL_CALL_COMPLETED, lifecycle);
        return result;
    }
}

export function createClient() {
    const client = new AnamClient();
    window.__evanHarness = client;
    return client;
}
