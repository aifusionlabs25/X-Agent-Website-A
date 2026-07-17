import { useEffect, useRef, useState, useCallback } from 'react';
import {
    createClient,
    AnamClient,
    AnamEvent,
    ConnectionClosedCode,
    MessageStreamEvent,
} from '@anam-ai/js-sdk';
import {
    bindAmyAnamClientSession,
    completeAmyAnamClientSession,
} from '@/lib/anam/session-spine-client';

export type TranscriptMessage = {
    role: 'user' | 'agent' | 'system' | 'error';
    content: string;
    id: string;
};

interface UseAnamQaSessionProps {
    personaId: string;
    sessionVariant?: string;
}

type ActiveSessionLifecycle = {
    client: AnamClient;
    completeOnce: (closeReason: string, maxAttempts?: number) => Promise<void>;
    removeListeners: () => void;
};

const transcriptRole = (role: string): 'user' | 'agent' => role === 'user' ? 'user' : 'agent';

export function useAnamQaSession({ personaId, sessionVariant }: UseAnamQaSessionProps) {
    const [client, setClient] = useState<AnamClient | null>(null);
    const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'streaming' | 'error'>('idle');
    const [messages, setMessages] = useState<TranscriptMessage[]>([]);
    const [sessionId, setSessionId] = useState<string | null>(null);
    
    // We use refs to handle live streaming chunks without causing excessive re-renders
    const currentMessageRef = useRef<string>('');
    const currentRoleRef = useRef<string>('');
    const isMounted = useRef(true);
    const activeSessionLifecycleRef = useRef<ActiveSessionLifecycle | null>(null);

    const appendMessage = useCallback((role: TranscriptMessage['role'], content: string) => {
        setMessages(prev => [...prev, { role, content, id: crypto.randomUUID() }]);
    }, []);

    const connect = useCallback(async (videoElementId: string) => {
        if (!personaId) return;
        
        setConnectionState('connecting');
        setSessionId(null);
        appendMessage('system', 'Initializing QA Session (Audio Input Disabled)...');

        try {
            // 1. Fetch Session Token
            const tokenRes = await fetch('/api/anam-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ personaId, variant: sessionVariant }),
            });

            if (!tokenRes.ok) throw new Error('Failed to fetch session token');
            const tokenPayload = await tokenRes.json() as {
                sessionToken?: string;
                sessionSpineEnabled?: boolean;
                launchId?: string;
                memoryContextAvailable?: boolean;
                memoryContext?: string;
                returningMemoryCount?: number;
            };
            if (typeof tokenPayload.sessionToken !== 'string') {
                throw new Error('Session token response was incomplete');
            }
            const { sessionToken } = tokenPayload;
            const sessionSpineActive = tokenPayload.sessionSpineEnabled === true
                && typeof tokenPayload.launchId === 'string';
            const launchId = sessionSpineActive ? tokenPayload.launchId ?? null : null;
            
            if (!isMounted.current) return;

            // 2. Initialize Anam Client with QA settings
            const anamClient = createClient(sessionToken, { 
                disableInputAudio: true // CRITICAL: Prevents mic permission prompt
            });
            const addPersonaContext = (context: string) => {
                const contextClient = anamClient as AnamClient & { addContext?: (value: string) => void };
                if (typeof contextClient.addContext !== 'function') {
                    throw new Error('The Anam client does not support live context injection.');
                }
                contextClient.addContext(context);
            };

            let providerSessionId: string | null = null;
            let bindPromise: Promise<void> | null = null;
            let completionPromise: Promise<void> | null = null;
            let closeHandled = false;
            let listenersRemoved = false;
            let connectionEstablished = false;
            let memoryContextInjected = false;
            const memoryContext = tokenPayload.memoryContextAvailable === true
                && typeof tokenPayload.memoryContext === 'string'
                ? tokenPayload.memoryContext
                : null;

            const applyMemoryContext = () => {
                if (
                    !memoryContext
                    || memoryContextInjected
                    || !connectionEstablished
                    || !providerSessionId
                ) return;
                try {
                    addPersonaContext(memoryContext);
                    memoryContextInjected = true;
                    appendMessage(
                        'system',
                        Number(tokenPayload.returningMemoryCount ?? 0) > 0
                            ? `Applied ${Number(tokenPayload.returningMemoryCount)} approved prior-session note(s).`
                            : 'Returning-memory identity linked; no approved prior-session notes found.',
                    );
                } catch {
                    if (isMounted.current) {
                        setConnectionState('error');
                        appendMessage('error', 'Approved returning memory could not be applied safely. Restart the session.');
                    }
                    void anamClient.stopStreaming().catch(() => undefined);
                }
            };

            const completeOnce = (closeReason: string, maxAttempts?: number): Promise<void> => {
                if (!sessionSpineActive || !launchId || !providerSessionId) {
                    return Promise.resolve();
                }
                if (completionPromise) return completionPromise;

                const activeCompletion = (async () => {
                    const receipt = await completeAmyAnamClientSession({
                        launchId,
                        sessionId: providerSessionId as string,
                        closeReason,
                        maxAttempts,
                    });
                    console.info('[Amy Anam Spine] QA session completion accepted', {
                        status: receipt.status,
                        receiptPresent: Boolean(receipt.receiptId),
                    });
                })();
                completionPromise = activeCompletion;
                activeCompletion.catch(() => {
                    if (completionPromise === activeCompletion) completionPromise = null;
                });
                return activeCompletion;
            };

            const handlePageHide = () => {
                void completeOnce('pagehide', 1).catch(() => undefined);
            };

            // Set up event listeners BEFORE connecting
            const handleConnectionEstablished = () => {
                if (!isMounted.current) return;
                connectionEstablished = true;
                applyMemoryContext();
                setConnectionState('streaming');
                appendMessage('system', 'Neural Link Established. Streaming ready.');
            };

            const handleSessionReady = (readySessionId: string) => {
                if (providerSessionId) return;
                providerSessionId = readySessionId;
                if (isMounted.current) setSessionId(readySessionId);
                applyMemoryContext();

                if (sessionSpineActive && launchId && !bindPromise) {
                    bindPromise = bindAmyAnamClientSession({
                        launchId,
                        sessionId: readySessionId,
                    });
                    bindPromise.catch(() => {
                        console.error('[Amy Anam Spine] QA session binding was not confirmed');
                    });
                }
            };

            // Capture live conversation chunks
            const handleMessageStream = (messageEvent: MessageStreamEvent) => {
                // If role changes, flush the previous message to state
                if (messageEvent.role !== currentRoleRef.current && currentRoleRef.current) {
                    if (currentMessageRef.current) {
                        appendMessage(transcriptRole(currentRoleRef.current), currentMessageRef.current.trim());
                    }
                    currentMessageRef.current = '';
                }
                
                currentRoleRef.current = messageEvent.role;
                currentMessageRef.current += messageEvent.content;

                if (messageEvent.endOfSpeech) {
                    if (currentMessageRef.current) {
                        appendMessage(transcriptRole(messageEvent.role), currentMessageRef.current.trim());
                    }
                    currentMessageRef.current = '';
                    currentRoleRef.current = '';
                }
            };

            const handleConnectionClosed = (reason: ConnectionClosedCode) => {
                if (closeHandled) return;
                closeHandled = true;

                if (sessionSpineActive) {
                    void completeOnce(String(reason)).catch(() => {
                        console.error('[Amy Anam Spine] QA session completion was not confirmed');
                    });
                }

                if (isMounted.current) {
                    setConnectionState('idle');
                    appendMessage('system', 'Session disconnected.');
                }
                
                // Flush remaining chunks
                if (isMounted.current && currentMessageRef.current && currentRoleRef.current) {
                    appendMessage(transcriptRole(currentRoleRef.current), currentMessageRef.current.trim());
                    currentMessageRef.current = '';
                    currentRoleRef.current = '';
                }
                removeClientListeners();
            };

            const removeClientListeners = () => {
                if (listenersRemoved) return;
                listenersRemoved = true;
                window.removeEventListener('pagehide', handlePageHide);
                anamClient.removeListener(AnamEvent.CONNECTION_ESTABLISHED, handleConnectionEstablished);
                anamClient.removeListener(AnamEvent.SESSION_READY, handleSessionReady);
                anamClient.removeListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, handleMessageStream);
                anamClient.removeListener(AnamEvent.CONNECTION_CLOSED, handleConnectionClosed);
            };

            if (sessionSpineActive) window.addEventListener('pagehide', handlePageHide);
            anamClient.addListener(AnamEvent.CONNECTION_ESTABLISHED, handleConnectionEstablished);
            anamClient.addListener(AnamEvent.SESSION_READY, handleSessionReady);
            anamClient.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, handleMessageStream);
            anamClient.addListener(AnamEvent.CONNECTION_CLOSED, handleConnectionClosed);
            activeSessionLifecycleRef.current = {
                client: anamClient,
                completeOnce,
                removeListeners: removeClientListeners,
            };

            // 3. Connect and Stream directly to the video element
            await anamClient.streamToVideoElement(videoElementId);

            if (isMounted.current) {
                setClient(anamClient);
            }

        } catch (err) {
            console.error('Anam QA Initialization Error:', err);
            if (isMounted.current) {
                setConnectionState('error');
                appendMessage('error', 'Failed to connect to the agent. Check console.');
            }
        }
    }, [personaId, sessionVariant, appendMessage]);

    const disconnect = useCallback(async () => {
        if (client) {
            appendMessage('system', 'Disconnecting...');
            await client.stopStreaming().catch(console.error);
            setClient(null);
            setConnectionState('idle');
        }
    }, [client, appendMessage]);

    const sendUserMessage = useCallback(async (text: string) => {
        if (!client || connectionState !== 'streaming') {
            appendMessage('error', 'Cannot send message: Not connected.');
            return;
        }
        if (!text.trim()) return;

        // Manually append the user's text to the transcript UI 
        // because sendUserMessage does not echo it back via events in text mode
        appendMessage('user', text.trim());
        
        try {
            await client.sendUserMessage(text.trim());
        } catch (err) {
            console.error('Failed to send text:', err);
            appendMessage('error', 'Failed to send message to Anam engine.');
        }
    }, [client, connectionState, appendMessage]);

    const interrupt = useCallback(() => {
        if (!client || connectionState !== 'streaming') return;
        client.interruptPersona();
        appendMessage('system', 'Persona interrupted.');
    }, [client, connectionState, appendMessage]);

    const clearMessages = useCallback(() => {
        setMessages([]);
    }, []);

    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
            const activeLifecycle = activeSessionLifecycleRef.current;
            activeSessionLifecycleRef.current = null;
            if (activeLifecycle) {
                activeLifecycle.removeListeners();
                void activeLifecycle.completeOnce('unmount').catch(() => undefined);
                void activeLifecycle.client.stopStreaming().catch(console.error);
            }
        };
    }, []);

    return {
        client,
        connectionState,
        messages,
        sessionId,
        connect,
        disconnect,
        sendUserMessage,
        interrupt,
        clearMessages
    };
}
