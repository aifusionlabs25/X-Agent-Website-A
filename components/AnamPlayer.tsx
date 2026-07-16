import { useEffect, useRef, useState } from 'react';
import {
    createClient,
    AnamClient,
    AnamEvent,
    ConnectionClosedCode,
    MessageStreamEvent,
} from '@anam-ai/js-sdk';
import {
    AnamAudioBridge,
    selectVoiceMeeterB1DeviceId,
} from '@/lib/anam/audio-bridge';
import { isAmyCara4Variant } from '@/lib/anam/session-config';
import {
    bindAmyAnamClientSession,
    confirmAmyAnamLiveIdentity,
    completeAmyAnamClientSession,
} from '@/lib/anam/session-spine-client';

interface AnamPlayerProps {
    personaId: string;
    sessionVariant?: string;
    audioBridge?: AnamAudioBridge;
    onClose?: () => void;
}

const transcriptRole = (role: string) => role === 'user' ? 'user' : 'agent';

export default function AnamPlayer({ personaId, sessionVariant, audioBridge, onClose }: AnamPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [isConnecting, setIsConnecting] = useState(true);
    const [isFinalizing, setIsFinalizing] = useState(false);

    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    const transcriptRef = useRef<{ role: string; content: string }[]>([]);
    const currentMessageRef = useRef<string>('');
    const currentRoleRef = useRef<string>('');

    useEffect(() => {
        let activeClient: AnamClient | null = null;
        let isMounted = true;
        let closeHandled = false;
        let sessionSpineActive = false;
        let launchId: string | null = null;
        let providerSessionId: string | null = null;
        let bindingPromise: Promise<void> | null = null;
        let completionPromise: Promise<void> | null = null;
        let removeClientListeners: (() => void) | null = null;
        let removeIdentityToolHandler: (() => void) | null = null;
        let completedUserTurns = 0;
        let confirmedContact: { preferredName: string; email: string } | null = null;
        const videoElement = videoRef.current;

        transcriptRef.current = [];
        currentMessageRef.current = '';
        currentRoleRef.current = '';
        setError(null);
        setIsConnecting(true);
        setIsFinalizing(false);

        const completeOnce = (closeReason: string): Promise<void> => {
            if (!sessionSpineActive || !launchId || !providerSessionId) {
                return Promise.resolve();
            }
            if (completionPromise) return completionPromise;

            const activeCompletion = (async () => {
                const receipt = await completeAmyAnamClientSession({
                    launchId: launchId as string,
                    sessionId: providerSessionId as string,
                    closeReason,
                });
                console.info('[Amy Anam Spine] Session completion accepted', {
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
            if (!sessionSpineActive || !launchId || !providerSessionId) return;
            void completeAmyAnamClientSession({
                launchId,
                sessionId: providerSessionId,
                closeReason: 'pagehide',
                maxAttempts: 1,
            }).catch(() => undefined);
        };
        window.addEventListener('pagehide', handlePageHide);

        const initializeAnam = async () => {
            try {
                const audioDeviceId = audioBridge
                    ? await selectVoiceMeeterB1DeviceId()
                    : undefined;

                if (!isMounted) return;

                // 1. Fetch Session Token
                const tokenRes = await fetch('/api/anam-token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ personaId, variant: sessionVariant }),
                });

                if (!tokenRes.ok) {
                    throw new Error('Failed to fetch session token');
                }

                const tokenPayload = await tokenRes.json() as {
                    sessionToken?: string;
                    sessionSpineEnabled?: boolean;
                    launchId?: string;
                    memoryPolicyContextAvailable?: boolean;
                    memoryPolicyContext?: string;
                    memoryUnlockAvailable?: boolean;
                };
                if (!tokenPayload.sessionToken) {
                    throw new Error('Session token response was incomplete');
                }
                const { sessionToken } = tokenPayload;
                sessionSpineActive = tokenPayload.sessionSpineEnabled === true
                    && typeof tokenPayload.launchId === 'string';
                launchId = sessionSpineActive ? tokenPayload.launchId ?? null : null;

                if (!isMounted) return;

                // 2. Initialize Anam Client
                const isAmyCara4 = isAmyCara4Variant(sessionVariant);
                const clientOptions = {
                    ...(audioDeviceId ? { audioDeviceId } : {}),
                    ...(isAmyCara4 ? { voiceDetection: { endOfSpeechSensitivity: 0.3 } } : {}),
                };
                const anamClient = createClient(sessionToken, clientOptions);

                activeClient = anamClient;
                const memoryPolicyContext = tokenPayload.memoryPolicyContextAvailable === true
                    && typeof tokenPayload.memoryPolicyContext === 'string'
                    ? tokenPayload.memoryPolicyContext
                    : null;
                let connectionEstablished = false;
                let memoryPolicyInjected = false;

                const applyMemoryPolicy = () => {
                    if (
                        !memoryPolicyContext
                        || memoryPolicyInjected
                        || !connectionEstablished
                        || !providerSessionId
                    ) return;
                    try {
                        anamClient.addContext(memoryPolicyContext);
                        memoryPolicyInjected = true;
                        console.info('[Amy Anam Memory] Live identity policy applied', {
                            memoryUnlockAvailable: tokenPayload.memoryUnlockAvailable === true,
                            contentLogged: false,
                        });
                    } catch {
                        if (isMounted) {
                            setError('Amy could not safely initialize returning memory. Please restart the session.');
                            setIsConnecting(false);
                        }
                        void anamClient.stopStreaming().catch(() => undefined);
                    }
                };

                // Set up event listeners BEFORE connecting
                const handleConnectionEstablished = () => {
                    console.log('Anam connection established');
                    connectionEstablished = true;
                    applyMemoryPolicy();
                    if (isMounted) setIsConnecting(false);
                };

                const handleMicPermissionDenied = (permissionError: string) => {
                    if (audioBridge && isMounted) {
                        setError(`VoiceMeeter bridge could not start: ${permissionError}`);
                        setIsConnecting(false);
                    }
                };

                const handleSessionReady = (sessionId: string) => {
                    if (providerSessionId) return;
                    providerSessionId = sessionId;
                    applyMemoryPolicy();
                    if (sessionSpineActive && launchId) {
                        bindingPromise = bindAmyAnamClientSession({
                            launchId,
                            sessionId,
                        });
                        void bindingPromise.catch(() => {
                            console.error('[Amy Anam Spine] Session binding was not confirmed');
                        });
                    }
                };

                // Capture live conversation chunks
                const handleMessageStream = (messageEvent: MessageStreamEvent) => {
                    if (messageEvent.role === 'user' && messageEvent.endOfSpeech) completedUserTurns += 1;
                    if (sessionSpineActive) return;
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
                };

                const handleConnectionClosed = async (reason: ConnectionClosedCode) => {
                    if (closeHandled) return;
                    closeHandled = true;
                    console.log('Anam connection closed');

                    if (sessionSpineActive) {
                        if (isMounted) setIsFinalizing(true);
                        try {
                            await completeOnce(String(reason));
                        } catch {
                            console.error('[Amy Anam Spine] Session completion was not confirmed');
                        } finally {
                            if (isMounted) setIsFinalizing(false);
                        }
                    }

                    // Push any trailing un-ended speech chunks
                    if (!sessionSpineActive && currentMessageRef.current) {
                        transcriptRef.current.push({ role: transcriptRole(currentRoleRef.current), content: currentMessageRef.current.trim() });
                        currentMessageRef.current = '';
                    }

                    if (!sessionSpineActive && transcriptRef.current.length > 0) {
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

                    if (isMounted) onCloseRef.current?.();
                };

                if (isAmyCara4) {
                    removeIdentityToolHandler = anamClient.registerToolCallHandler(
                        'confirm_live_identity',
                        {
                            onStart: async payload => {
                                if (tokenPayload.memoryUnlockAvailable !== true) {
                                    return JSON.stringify({
                                        status: 'memory_unavailable',
                                        instruction: 'Continue without returning memory. Do not request contact details solely for memory.',
                                    });
                                }
                                if (completedUserTurns < 2) {
                                    throw new Error('Continue the warm conversation before confirming identity.');
                                }

                                const preferredName = typeof payload.arguments.preferredName === 'string'
                                    ? payload.arguments.preferredName.trim()
                                    : '';
                                const email = typeof payload.arguments.email === 'string'
                                    ? payload.arguments.email.trim()
                                    : '';
                                if (!preferredName || !email) {
                                    throw new Error('Ask for and explicitly confirm the name and email separately.');
                                }
                                if (!sessionSpineActive || !launchId || !providerSessionId || !bindingPromise) {
                                    throw new Error('The private session is not ready. Continue the conversation and try once more.');
                                }

                                const normalizedEmail = email.toLowerCase();
                                if (confirmedContact) {
                                    return JSON.stringify({
                                        status: confirmedContact.email === normalizedEmail
                                            ? 'memory_already_unlocked'
                                            : 'identity_already_confirmed',
                                        instruction: 'Use the stored confirmed contact. Never repeat or reconstruct the email aloud.',
                                    });
                                }

                                await bindingPromise;
                                const result = await confirmAmyAnamLiveIdentity({
                                    launchId,
                                    sessionId: providerSessionId,
                                    preferredName,
                                    email,
                                });
                                confirmedContact = { preferredName: result.preferredName, email: normalizedEmail };
                                anamClient.addContext(result.memoryContext);
                                console.info('[Amy Anam Memory] Returning context unlocked', {
                                    approvedSessionCount: result.memoryCount,
                                    contactContentLogged: false,
                                });
                                return JSON.stringify({
                                    status: 'memory_unlocked',
                                    memoryCount: result.memoryCount,
                                    instruction: 'Use approved context naturally. Refer to the address only as the confirmed email; never repeat or reconstruct it aloud.',
                                });
                            },
                        },
                    );
                }

                anamClient.addListener(AnamEvent.CONNECTION_ESTABLISHED, handleConnectionEstablished);
                anamClient.addListener(AnamEvent.MIC_PERMISSION_DENIED, handleMicPermissionDenied);
                anamClient.addListener(AnamEvent.SESSION_READY, handleSessionReady);
                anamClient.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, handleMessageStream);
                anamClient.addListener(AnamEvent.CONNECTION_CLOSED, handleConnectionClosed);
                removeClientListeners = () => {
                    anamClient.removeListener(AnamEvent.CONNECTION_ESTABLISHED, handleConnectionEstablished);
                    anamClient.removeListener(AnamEvent.MIC_PERMISSION_DENIED, handleMicPermissionDenied);
                    anamClient.removeListener(AnamEvent.SESSION_READY, handleSessionReady);
                    anamClient.removeListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, handleMessageStream);
                    anamClient.removeListener(AnamEvent.CONNECTION_CLOSED, handleConnectionClosed);
                };

                // 3. Connect and Stream directly to the video element
                await anamClient.streamToVideoElement('persona-video');

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
            window.removeEventListener('pagehide', handlePageHide);
            removeClientListeners?.();
            removeIdentityToolHandler?.();
            // Cleanup on unmount
            if (activeClient) {
                void completeOnce('unmount').catch(() => undefined);
                void activeClient.stopStreaming()
                    .catch(console.error);
            }
            if (videoElement) {
                videoElement.srcObject = null;
            }
        };
    }, [personaId, sessionVariant, audioBridge]);

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

            {isFinalizing && !error && (
                <div className="absolute inset-0 flex items-center justify-center z-30 bg-zinc-950/70 backdrop-blur-sm">
                    <div className="flex flex-col items-center space-y-3">
                        <div className="w-10 h-10 border-4 border-zinc-700 border-t-emerald-300 rounded-full animate-spin"></div>
                        <p className="text-emerald-200 text-xs tracking-widest uppercase">Securing session record...</p>
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
