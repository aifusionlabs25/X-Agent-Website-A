import { useEffect, useRef, useState } from 'react';
import {
    createClient,
    AnamClient,
    AnamEvent,
    ConnectionClosedCode,
    MessageStreamEvent,
} from '@anam-ai/js-sdk';
import { BrainCircuit } from 'lucide-react';
import AmyAnamWorkbenchV2 from '@/components/amy/AmyAnamWorkbenchV2';
import {
    AnamAudioBridge,
    selectVoiceMeeterB1DeviceId,
} from '@/lib/anam/audio-bridge';
import { sendAmyAnamFollowUpEmail } from '@/lib/anam/agentmail-client';
import { isAmyCara4Variant } from '@/lib/anam/session-config';
import {
    bindAmyAnamClientSession,
    confirmAmyAnamLiveIdentity,
    completeAmyAnamClientSession,
} from '@/lib/anam/session-spine-client';
import { AmyWorkbenchTurn, AmyWorkbenchView } from '@/lib/anam/workbench-v2';

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
    const [workbenchOpen, setWorkbenchOpen] = useState(false);
    const [workbenchView, setWorkbenchView] = useState<AmyWorkbenchView>('notes');
    const [workbenchTurns, setWorkbenchTurns] = useState<AmyWorkbenchTurn[]>([]);
    const [roadmapTopic, setRoadmapTopic] = useState('');
    const [catalogQuery, setCatalogQuery] = useState('');
    const workbenchEnabled = isAmyCara4Variant(sessionVariant)
        && process.env.NEXT_PUBLIC_AMY_ANAM_WORKBENCH_ENABLED !== 'false';

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
        let removeEmailToolHandler: (() => void) | null = null;
        let completedUserTurns = 0;
        let confirmedMemoryName: string | null = null;
        const videoElement = videoRef.current;

        transcriptRef.current = [];
        currentMessageRef.current = '';
        currentRoleRef.current = '';
        setError(null);
        setIsConnecting(true);
        setIsFinalizing(false);
        setWorkbenchOpen(false);
        setWorkbenchView('notes');
        setWorkbenchTurns([]);
        setRoadmapTopic('');
        setCatalogQuery('');

        const recordTurn = (role: string, content: string) => {
            const normalized = content.trim();
            if (!normalized) return;
            const turn = { role: transcriptRole(role), content: normalized } as AmyWorkbenchTurn;
            transcriptRef.current = [...transcriptRef.current.slice(-399), turn];
            if (workbenchEnabled) {
                setWorkbenchTurns((current) => [...current.slice(-59), turn]);
            }
        };

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
                    const errorPayload = await tokenRes.json().catch(() => null) as { error?: unknown } | null;
                    const serverMessage = typeof errorPayload?.error === 'string'
                        ? errorPayload.error.trim()
                        : '';
                    throw new Error(serverMessage || 'Failed to start the agent session');
                }

                const tokenPayload = await tokenRes.json() as {
                    sessionToken?: string;
                    sessionSpineEnabled?: boolean;
                    launchId?: string;
                    memoryPolicyContextAvailable?: boolean;
                    memoryPolicyContext?: string;
                    memoryUnlockAvailable?: boolean;
                    agentMailAvailable?: boolean;
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
                    ...(isAmyCara4 ? { voiceDetection: { endOfSpeechSensitivity: 0.15 } } : {}),
                };
                const anamClient = createClient(sessionToken, clientOptions);

                activeClient = anamClient;
                const cancelWorkbenchHandlers: Array<() => void> = [];
                if (workbenchEnabled) {
                    const registerView = (
                        toolName: string,
                        view: AmyWorkbenchView,
                        confirmation: string,
                    ) => {
                        cancelWorkbenchHandlers.push(anamClient.registerToolCallHandler(toolName, {
                            onStart: async (payload) => {
                                if (isMounted) {
                                    if (view === 'roadmap') {
                                        const topic = typeof payload.arguments?.topic === 'string'
                                            ? payload.arguments.topic.trim().slice(0, 2_000)
                                            : '';
                                        setRoadmapTopic(topic);
                                    } else if (view === 'catalog') {
                                        const query = typeof payload.arguments?.query === 'string'
                                            ? payload.arguments.query.trim().slice(0, 500)
                                            : '';
                                        setCatalogQuery(query);
                                    }
                                    setWorkbenchView(view);
                                    setWorkbenchOpen(true);
                                }
                                return confirmation;
                            },
                        }));
                    };

                    registerView('show_live_notes', 'notes', "Opened Amy's Live Notes using current-session conversation signals.");
                    registerView('show_session_brief', 'brief', "Opened Amy's Live Brief using current-session conversation signals.");
                    registerView('show_solution_roadmap', 'roadmap', "Opened Amy's illustrative Roadmap for the current conversation.");
                    registerView('show_visual_brief', 'visual', "Opened Amy's Visual Brief for the current conversation.");
                    registerView('show_solution_catalog', 'catalog', "Opened Amy's directional solution categories. Live pricing and inventory are not shown.");
                }
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
                    if (messageEvent.role !== currentRoleRef.current) {
                        if (currentMessageRef.current) {
                            recordTurn(currentRoleRef.current, currentMessageRef.current);
                        }
                        currentRoleRef.current = messageEvent.role;
                        currentMessageRef.current = messageEvent.content;
                    } else {
                        currentMessageRef.current += messageEvent.content;
                    }

                    if (messageEvent.endOfSpeech) {
                        if (currentMessageRef.current) {
                            recordTurn(messageEvent.role, currentMessageRef.current);
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
                    if (currentMessageRef.current) {
                        recordTurn(currentRoleRef.current, currentMessageRef.current);
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
                                const memoryAccessConfirmed = payload.arguments.memoryAccessConfirmed === true;
                                if (!preferredName || !memoryAccessConfirmed) {
                                    throw new Error('Ask for the preferred name and explicit permission to check previous notes.');
                                }
                                if (!sessionSpineActive || !launchId || !providerSessionId || !bindingPromise) {
                                    throw new Error('The private session is not ready. Continue the conversation and try once more.');
                                }

                                if (confirmedMemoryName) {
                                    return JSON.stringify({
                                        status: 'memory_already_unlocked',
                                        instruction: 'Use the memory context already provided. Do not request contact details solely for memory.',
                                    });
                                }

                                await bindingPromise;
                                const result = await confirmAmyAnamLiveIdentity({
                                    launchId,
                                    sessionId: providerSessionId,
                                    preferredName,
                                    memoryAccessConfirmed: true,
                                });
                                confirmedMemoryName = result.preferredName;
                                anamClient.addContext(result.memoryContext);
                                console.info('[Amy Anam Memory] Returning context unlocked', {
                                    approvedSessionCount: result.memoryCount,
                                    identityContentLogged: false,
                                });
                                return JSON.stringify({
                                    status: 'memory_unlocked',
                                    memoryCount: result.memoryCount,
                                    instruction: result.memoryCount > 0 ? 'In your next reply, say naturally that you found approved notes from an earlier conversation. Mention at most two or three distinctive earlier-session facts that the visitor has not already supplied today, then ask whether they are still current. Use no more than two short sentences. Do not say memory unlocked or ask for contact details.' : 'Say plainly that no approved earlier-session notes were found, then continue naturally. Do not fill the gap with current-call facts or ask for contact details.',
                                });
                            },
                        },
                    );
                    removeEmailToolHandler = anamClient.registerToolCallHandler(
                        'send_follow_up_email',
                        {
                            onStart: async payload => {
                                if (tokenPayload.agentMailAvailable !== true) {
                                    return JSON.stringify({
                                        status: 'email_unavailable',
                                        instruction: 'Say that email is temporarily unavailable. Do not claim anything was sent and do not end the call automatically.',
                                    });
                                }
                                if (completedUserTurns < 1) {
                                    throw new Error('Continue the conversation before offering an email follow-up.');
                                }
                                if (payload.arguments.userConfirmed !== true) {
                                    throw new Error('Ask the visitor for explicit permission before sending email.');
                                }
                                if (!sessionSpineActive || !launchId || !providerSessionId || !bindingPromise) {
                                    throw new Error('The private session is not ready. Continue the conversation and try once more.');
                                }

                                await bindingPromise;
                                const result = await sendAmyAnamFollowUpEmail({
                                    launchId,
                                    sessionId: providerSessionId,
                                    userConfirmed: true,
                                });
                                console.info('[Amy Anam AgentMail] Post-session intent recorded', {
                                    status: result.status,
                                    queued: result.queued,
                                    duplicate: result.duplicate,
                                    contactContentLogged: false,
                                });
                                return JSON.stringify({
                                    status: result.status,
                                    queued: result.queued,
                                    sent: false,
                                    duplicate: result.duplicate,
                                    receiptId: result.receiptId,
                                    instruction: result.duplicate
                                        ? 'Confirm briefly that the post-session email is already scheduled. Do not say it was sent yet, and do not end the call automatically.'
                                        : 'Confirm briefly that the follow-up will be emailed after this session ends. Do not say it was sent yet. Then continue naturally and end only when the visitor clearly says they are finished.',
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
                    cancelWorkbenchHandlers.forEach((cancel) => cancel());
                };

                // 3. Connect and Stream directly to the video element
                await anamClient.streamToVideoElement('persona-video');

            } catch (err) {
                console.error('Anam Initialization Error:', err);
                if (isMounted) {
                    setError(
                        err instanceof Error ? err.message : 'Failed to connect to the agent. Please try again later.',
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
            removeEmailToolHandler?.();
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
    }, [personaId, sessionVariant, audioBridge, workbenchEnabled]);

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

            <div className={`h-full w-full transition-[padding] duration-500 ease-out ${workbenchEnabled && workbenchOpen ? 'lg:pr-[min(56vw,820px)]' : ''}`}>
                <video
                    ref={videoRef}
                    id="persona-video"
                    autoPlay
                    playsInline
                    className={`w-full h-full object-contain transition-opacity duration-700 ${isConnecting ? 'opacity-0' : 'opacity-100'}`}
                />
            </div>

            {workbenchEnabled && !workbenchOpen && !error && !isConnecting && (
                <button
                    type="button"
                    onClick={() => setWorkbenchOpen(true)}
                    className="absolute right-5 top-5 z-30 inline-flex items-center gap-2 border border-white/15 bg-black/65 px-4 py-2.5 text-xs font-semibold text-white shadow-2xl backdrop-blur-md transition hover:border-[#ff2f8a]/60 hover:bg-black/80"
                >
                    <BrainCircuit size={16} className="text-[#ff68a9]" />
                    Amy Intelligence
                </button>
            )}

            {workbenchEnabled && (
                <AmyAnamWorkbenchV2
                    isOpen={workbenchOpen}
                    view={workbenchView}
                    turns={workbenchTurns}
                    roadmapTopic={roadmapTopic}
                    catalogQuery={catalogQuery}
                    onViewChange={setWorkbenchView}
                    onClose={() => setWorkbenchOpen(false)}
                />
            )}

            {/* Optional: Add a subtle animated grid overlay for the "HUD" feel */}
            <div className="pointer-events-none absolute inset-0 bg-white opacity-[0.03] mix-blend-overlay"></div>
        </div>
    );
}
