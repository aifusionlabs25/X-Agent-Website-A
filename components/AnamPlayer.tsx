import { useEffect, useRef, useState } from 'react';
import { createClient, AnamClient, AnamEvent, MessageStreamEvent } from '@anam-ai/js-sdk';

interface AnamPlayerProps {
    personaId: string;
    onClose?: () => void;
}

export default function AnamPlayer({ personaId, onClose }: AnamPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [client, setClient] = useState<AnamClient | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isConnecting, setIsConnecting] = useState(true);

    const transcriptRef = useRef<{ role: string; content: string }[]>([]);
    const currentMessageRef = useRef<string>('');
    const currentRoleRef = useRef<string>('');

    useEffect(() => {
        let activeClient: AnamClient | null = null;
        let isMounted = true;

        const initializeAnam = async () => {
            try {
                // 1. Fetch Session Token
                const tokenRes = await fetch('/api/anam-token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ personaId }),
                });

                if (!tokenRes.ok) {
                    throw new Error('Failed to fetch session token');
                }

                const { sessionToken } = await tokenRes.json();

                if (!isMounted) return;

                // 2. Initialize Anam Client
                const anamClient = createClient(sessionToken);

                // Set up event listeners BEFORE connecting
                anamClient.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => {
                    console.log('Anam connection established');
                    setIsConnecting(false);
                });

                // Capture live conversation chunks
                anamClient.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (messageEvent: MessageStreamEvent) => {
                    if (messageEvent.role !== currentRoleRef.current) {
                        if (currentMessageRef.current) {
                            transcriptRef.current.push({ role: currentRoleRef.current, content: currentMessageRef.current.trim() });
                        }
                        currentRoleRef.current = messageEvent.role;
                        currentMessageRef.current = messageEvent.content;
                    } else {
                        currentMessageRef.current += messageEvent.content;
                    }

                    if (messageEvent.endOfSpeech) {
                        if (currentMessageRef.current) {
                            transcriptRef.current.push({ role: messageEvent.role, content: currentMessageRef.current.trim() });
                        }
                        currentMessageRef.current = '';
                        currentRoleRef.current = '';
                    }
                });

                // Save on close
                anamClient.addListener(AnamEvent.CONNECTION_CLOSED, () => {
                    console.log('Anam connection closed');

                    // Push any trailing un-ended speech chunks
                    if (currentMessageRef.current) {
                        transcriptRef.current.push({ role: currentRoleRef.current, content: currentMessageRef.current.trim() });
                        currentMessageRef.current = '';
                    }

                    if (transcriptRef.current.length > 0) {
                        fetch('/api/save-transcript', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ personaId, transcript: transcriptRef.current }),
                        }).catch(console.error);
                    }

                    if (onClose) onClose();
                });

                // 3. Connect and Stream directly to the video element
                await anamClient.streamToVideoElement('persona-video');

                if (isMounted) {
                    setClient(anamClient);
                    activeClient = anamClient;
                }

            } catch (err) {
                console.error('Anam Initialization Error:', err);
                if (isMounted) {
                    setError('Failed to connect to the agent. Please try again later.');
                    setIsConnecting(false);
                }
            }
        };

        initializeAnam();

        return () => {
            isMounted = false;
            // Cleanup on unmount
            if (activeClient) {
                activeClient.stopStreaming().catch(console.error);
                // Currently, `removeAllListeners` doesn't exist on `AnamClient` according to typings.
                // We rely on stopStreaming to clean up resources.
            }
            if (videoRef.current) {
                videoRef.current.srcObject = null;
            }
        };
    }, [personaId, onClose]);

    return (
        <div className="relative w-full h-full bg-zinc-950 flex flex-col items-center justify-center">
            {error && (
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 p-6 flex flex-col items-center text-center z-10">
                    <p className="text-red-400 font-bold mb-4">{error}</p>
                    <button
                        onClick={onClose}
                        className="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-2 rounded-md transition-colors"
                    >
                        Close
                    </button>
                </div>
            )}

            {isConnecting && !error && (
                <div className="absolute inset-0 flex items-center justify-center z-10 bg-zinc-950/50 backdrop-blur-sm">
                    <div className="flex flex-col items-center space-y-4">
                        <div className="w-12 h-12 border-4 border-zinc-700 border-t-white rounded-full animate-spin"></div>
                        <p className="text-white text-sm tracking-widest uppercase animate-pulse">Establishing Neural Link...</p>
                    </div>
                </div>
            )}

            <video
                ref={videoRef}
                id="persona-video"
                autoPlay
                playsInline
                className={`w-full h-full object-contain transition-opacity duration-700 ${isConnecting ? 'opacity-0' : 'opacity-100'}`}
            />

            {/* Optional: Add a subtle animated grid overlay for the "HUD" feel */}
            <div className="pointer-events-none absolute inset-0 bg-white opacity-[0.03] mix-blend-overlay"></div>
        </div>
    );
}
