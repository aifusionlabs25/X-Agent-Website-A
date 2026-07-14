import { useEffect, useRef, useState, useCallback } from 'react';
import { createClient, AnamClient, AnamEvent, MessageStreamEvent } from '@anam-ai/js-sdk';

export type TranscriptMessage = {
    role: 'user' | 'agent' | 'system' | 'error';
    content: string;
    id: string;
};

interface UseAnamQaSessionProps {
    personaId: string;
    sessionVariant?: string;
}

const transcriptRole = (role: string): 'user' | 'agent' => role === 'user' ? 'user' : 'agent';

export function useAnamQaSession({ personaId, sessionVariant }: UseAnamQaSessionProps) {
    const [client, setClient] = useState<AnamClient | null>(null);
    const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'streaming' | 'error'>('idle');
    const [messages, setMessages] = useState<TranscriptMessage[]>([]);
    const [sessionId] = useState<string | null>(null);
    
    // We use refs to handle live streaming chunks without causing excessive re-renders
    const currentMessageRef = useRef<string>('');
    const currentRoleRef = useRef<string>('');
    const isMounted = useRef(true);

    const appendMessage = useCallback((role: TranscriptMessage['role'], content: string) => {
        setMessages(prev => [...prev, { role, content, id: crypto.randomUUID() }]);
    }, []);

    const connect = useCallback(async (videoElementId: string) => {
        if (!personaId) return;
        
        setConnectionState('connecting');
        appendMessage('system', 'Initializing QA Session (Audio Input Disabled)...');

        try {
            // 1. Fetch Session Token
            const tokenRes = await fetch('/api/anam-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ personaId, variant: sessionVariant }),
            });

            if (!tokenRes.ok) throw new Error('Failed to fetch session token');
            const { sessionToken } = await tokenRes.json();
            
            if (!isMounted.current) return;

            // 2. Initialize Anam Client with QA settings
            const anamClient = createClient(sessionToken, { 
                disableInputAudio: true // CRITICAL: Prevents mic permission prompt
            });

            // Set up event listeners BEFORE connecting
            anamClient.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => {
                if (!isMounted.current) return;
                setConnectionState('streaming');
                appendMessage('system', 'Neural Link Established. Streaming ready.');
                // Note: The Anam JS SDK does not expose sessionId synchronously here easily, 
                // but we track it conceptually if an event provides it later.
            });

            // Capture live conversation chunks
            anamClient.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (messageEvent: MessageStreamEvent) => {
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
            });

            anamClient.addListener(AnamEvent.CONNECTION_CLOSED, () => {
                if (!isMounted.current) return;
                setConnectionState('idle');
                appendMessage('system', 'Session disconnected.');
                
                // Flush remaining chunks
                if (currentMessageRef.current && currentRoleRef.current) {
                    appendMessage(transcriptRole(currentRoleRef.current), currentMessageRef.current.trim());
                    currentMessageRef.current = '';
                    currentRoleRef.current = '';
                }
            });

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
