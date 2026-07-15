import { useEffect, useRef, useState } from 'react';
import { createClient, AnamClient, AnamEvent, MessageStreamEvent } from '@anam-ai/js-sdk';
import {
    AnamAudioBridge,
    selectVoiceMeeterB1DeviceId,
} from '@/lib/anam/audio-bridge';

interface AnamPlayerProps {
    personaId: string;
    sessionVariant?: string;
    audioBridge?: AnamAudioBridge;
    onClose?: () => void;
}

const transcriptRole = (role: string) => role === 'user' ? 'user' : 'agent';

export default function AnamPlayer({ personaId, sessionVariant, audioBridge, onClose }: AnamPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [, setClient] = useState<AnamClient | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isConnecting, setIsConnecting] = useState(true);
    const [audioBridgeStatus, setAudioBridgeStatus] = useState<string | null>(
        audioBridge ? 'Finding VoiceMeeter Out B1...' : null,
    );

    const transcriptRef = useRef<{ role: string; content: string }[]>([]);
    const currentMessageRef = useRef<string>('');
    const currentRoleRef = useRef<string>('');

    useEffect(() => {
        let activeClient: AnamClient | null = null;
        let isMounted = true;
        const videoElement = videoRef.current;

        setError(null);
        setIsConnecting(true);
        setAudioBridgeStatus(audioBridge ? 'Finding VoiceMeeter Out B1...' : null);

        const initializeAnam = async () => {
            try {
                const audioDeviceId = audioBridge
                    ? await selectVoiceMeeterB1DeviceId()
                    : undefined;

                if (!isMounted) return;

                if (audioDeviceId) {
                    setAudioBridgeStatus('VoiceMeeter Out B1 selected');
                }

                // 1. Fetch Session Token
                const tokenRes = await fetch('/api/anam-token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ personaId, variant: sessionVariant }),
                });

                if (!tokenRes.ok) {
                    throw new Error('Failed to fetch session token');
                }

                const { sessionToken } = await tokenRes.json();

                if (!isMounted) return;

                // 2. Initialize Anam Client
                const anamClient = audioDeviceId
                    ? createClient(sessionToken, { audioDeviceId })
                    : createClient(sessionToken);

                activeClient = anamClient;

                // Set up event listeners BEFORE connecting
                anamClient.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => {
                    console.log('Anam connection established');
                    setIsConnecting(false);
                });

                anamClient.addListener(AnamEvent.MIC_PERMISSION_GRANTED, () => {
                    if (audioBridge && isMounted) {
                        setAudioBridgeStatus('VoiceMeeter Out B1 connected');
                    }
                });

                anamClient.addListener(AnamEvent.MIC_PERMISSION_DENIED, (permissionError: string) => {
                    if (audioBridge && isMounted) {
                        setError(`VoiceMeeter bridge could not start: ${permissionError}`);
                        setIsConnecting(false);
                    }
                });

                // Capture live conversation chunks
                anamClient.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (messageEvent: MessageStreamEvent) => {
                    if (messageEvent.role !== currentRoleRef.current) {
                        if (currentMessageRef.current) {
                            transcriptRef.current.push({ role: transcriptRole(currentRoleRef.current), content: currentMessageRef.current.trim() });
                        }
                        currentRoleRef.current = messageEvent.role;
                        currentMessageRef.current = messageEvent.content;
                    } else {
                        currentMessageRef.current += messageEvent.content;
                    }

                    if (messageEvent.endOfSpeech) {
                        if (currentMessageRef.current) {
                            transcriptRef.current.push({ role: transcriptRole(messageEvent.role), content: currentMessageRef.current.trim() });
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
                        transcriptRef.current.push({ role: transcriptRole(currentRoleRef.current), content: currentMessageRef.current.trim() });
                        currentMessageRef.current = '';
                    }

                    if (transcriptRef.current.length > 0) {
                        fetch('/api/save-transcript', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                personaId,
                                variant: sessionVariant,
                                transcript: transcriptRef.current,
                            }),
                        }).catch(console.error);
                    }

                    if (onClose) onClose();
                });

                // 3. Connect and Stream directly to the video element
                await anamClient.streamToVideoElement('persona-video');

                if (isMounted) {
                    setClient(anamClient);
                }

            } catch (err) {
                console.error('Anam Initialization Error:', err);
                if (isMounted) {
                    setError(
                        audioBridge && err instanceof Error
                            ? err.message
                            : 'Failed to connect to the agent. Please try again later.',
                    );
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
            if (videoElement) {
                videoElement.srcObject = null;
            }
        };
    }, [personaId, sessionVariant, audioBridge, onClose]);

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

            {audioBridgeStatus && !error && (
                <div
                    className="absolute top-4 left-1/2 -translate-x-1/2 z-20 rounded-full border border-emerald-400/40 bg-black/70 px-4 py-2 text-xs font-mono text-emerald-300 backdrop-blur-sm"
                    data-audio-bridge-status={audioBridgeStatus}
                >
                    Audio bridge: {audioBridgeStatus}
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
