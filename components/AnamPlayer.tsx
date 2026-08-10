import { useEffect, useRef, useState } from 'react';
import {
    createClient,
    AnamClient,
    AnamEvent,
    ConnectionClosedCode,
    MessageStreamEvent,
} from '@anam-ai/js-sdk';
import { BrainCircuit, Truck } from 'lucide-react';
import AmyAnamWorkbenchV2 from '@/components/amy/AmyAnamWorkbenchV2';
import EvanMovePlanner from '@/components/evan/EvanMovePlanner';
import {
    AnamAudioBridge,
    selectVoiceMeeterB1DeviceId,
} from '@/lib/anam/audio-bridge';
import { sendAmyAnamFollowUpEmail, setDaniAnamFollowUpPreference } from '@/lib/anam/agentmail-client';
import { DANI_PERSONA_ID, EVAN_PERSONA_ID } from '@/lib/anam/persona-ids';
import { isAmyCara4Variant } from '@/lib/anam/session-config';
import {
    bindAmyAnamClientSession,
    confirmAmyAnamLiveIdentity,
    confirmDaniAnamLiveIdentity,
    completeAmyAnamClientSession,
} from '@/lib/anam/session-spine-client';
import { AmyWorkbenchTurn, AmyWorkbenchView, buildAmyWorkbenchModel } from '@/lib/anam/workbench-v2';
import { buildEvanMovePlan, EvanMovePlannerView, MovePlanStop } from '@/lib/anam/evan-move-planner';
import {
    parseEvanRouteToolStops,
    parseResolvedEvanRouteStops,
    routeToolStopsToMovePlanStops,
} from '@/lib/anam/evan-address-route';
import { createEvanFarewellCloseCoordinator } from '@/lib/anam/evan-session-close';

interface AnamPlayerProps {
    personaId: string;
    sessionVariant?: string;
    audioBridge?: AnamAudioBridge;
    onClose?: () => void;
}

const transcriptRole = (role: string) => /^(?:user|human|customer)$/i.test(role.trim()) ? 'user' : 'agent';

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
    const [evanPlannerOpen, setEvanPlannerOpen] = useState(false);
    const [evanPlannerView, setEvanPlannerView] = useState<EvanMovePlannerView>('brief');
    const [evanAddressStops, setEvanAddressStops] = useState<MovePlanStop[]>([]);
    const workbenchEnabled = isAmyCara4Variant(sessionVariant)
        && process.env.NEXT_PUBLIC_AMY_ANAM_WORKBENCH_ENABLED !== 'false';
    const evanPlannerEnabled = personaId === EVAN_PERSONA_ID
        && process.env.NEXT_PUBLIC_EVAN_MOVE_PLANNER_ENABLED !== 'false';

    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    const transcriptRef = useRef<{ role: string; content: string }[]>([]);
    const currentMessageRef = useRef<string>('');
    const currentRoleRef = useRef<string>('');
    const evanAddressStopsRef = useRef<MovePlanStop[]>([]);

    useEffect(() => {
        if (!evanPlannerEnabled || !evanPlannerOpen) return;

        const refreshPlanner = () => {
            const latestTurns = transcriptRef.current.slice(-120) as AmyWorkbenchTurn[];
            const pendingContent = currentMessageRef.current.trim();
            const pendingRole = transcriptRole(currentRoleRef.current);
            if (
                pendingContent
                && pendingRole === 'user'
                && latestTurns.at(-1)?.content !== pendingContent
            ) {
                latestTurns.push({ role: 'user', content: pendingContent });
            }
            setWorkbenchTurns((current) => {
                const next = latestTurns.slice(-120);
                const unchanged = current.length === next.length
                    && current.every((turn, index) => (
                        turn.role === next[index]?.role
                        && turn.content === next[index]?.content
                    ));
                return unchanged ? current : next;
            });
        };

        refreshPlanner();
        const intervalId = window.setInterval(refreshPlanner, 400);
        return () => window.clearInterval(intervalId);
    }, [evanPlannerEnabled, evanPlannerOpen]);

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
        let removeCloseToolHandler: (() => void) | null = null;
        let requestedCloseReason: string | null = null;
        let evanCloseCoordinator: ReturnType<typeof createEvanFarewellCloseCoordinator> | null = null;
        let completedUserTurns = 0;
        let workbenchRevision = 0;
        let confirmedMemoryName: string | null = null;
        let requestedCloseFallbackTimer: number | null = null;
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
        setEvanPlannerOpen(false);
        setEvanPlannerView('brief');
        evanAddressStopsRef.current = [];
        setEvanAddressStops([]);

        const recordTurn = (role: string, content: string) => {
            const normalized = content.trim();
            if (!normalized) return;
            const turn = { role: transcriptRole(role), content: normalized } as AmyWorkbenchTurn;
            transcriptRef.current = [...transcriptRef.current.slice(-399), turn];
            if (workbenchEnabled || evanPlannerEnabled) {
                setWorkbenchTurns((current) => [...current.slice(-59), turn]);
            }
        };

        const snapshotEvanPlannerTurns = () => {
            const latestTurns = transcriptRef.current.slice(-120) as AmyWorkbenchTurn[];
            const pendingContent = currentMessageRef.current.trim();
            const pendingTurn = pendingContent
                ? { role: transcriptRole(currentRoleRef.current), content: pendingContent } as AmyWorkbenchTurn
                : null;
            if (
                pendingTurn
                && pendingTurn.role === 'user'
                && latestTurns.at(-1)?.content !== pendingTurn.content
            ) {
                latestTurns.push(pendingTurn);
            }
            return latestTurns.slice(-120);
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

        const handleDaniRequestedEnd = () => {
            if (personaId !== DANI_PERSONA_ID || closeHandled) return;
            requestedCloseReason = 'user_requested_end';
            if (isMounted) setIsFinalizing(true);

            if (!activeClient) {
                closeHandled = true;
                if (isMounted) {
                    setIsFinalizing(false);
                    onCloseRef.current?.();
                }
                return;
            }

            // Keep the page mounted while Anam closes its stream. Immediate route
            // navigation can tear down the SDK before the provider finalizes its
            // transcript. The normal connection-closed handler remains primary;
            // this bounded fallback only prevents a stuck exit.
            void activeClient.stopStreaming().catch(() => undefined).finally(() => {
                requestedCloseFallbackTimer = window.setTimeout(() => {
                    if (closeHandled || !isMounted) return;
                    closeHandled = true;
                    void completeOnce('user_requested_end')
                        .catch(() => undefined)
                        .finally(() => {
                            if (!isMounted) return;
                            setIsFinalizing(false);
                            onCloseRef.current?.();
                        });
                }, 1_500);
            });
        };
        window.addEventListener('xagent:dani-request-end', handleDaniRequestedEnd);

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
                const isDani = personaId === DANI_PERSONA_ID;
                const isEvan = personaId === EVAN_PERSONA_ID;
                const memoryAgentLabel = isDani ? 'Dani' : 'Amy';
                const clientOptions = {
                    ...(audioDeviceId ? { audioDeviceId } : {}),
                    ...(isAmyCara4 || isDani ? { voiceDetection: { endOfSpeechSensitivity: 0.05 } } : {}),
                };
                const anamClient = createClient(sessionToken, clientOptions);

                activeClient = anamClient;
                if (isEvan) {
                    evanCloseCoordinator = createEvanFarewellCloseCoordinator({
                        stopStreaming: () => anamClient.stopStreaming(),
                        onStopError: () => console.error('[Evan Anam] Farewell close was not confirmed'),
                    });
                }
                const cancelWorkbenchHandlers: Array<() => void> = [];
                if (workbenchEnabled) {
                    const registerView = (
                        toolName: string,
                        view: AmyWorkbenchView,
                        confirmation: string,
                    ) => {
                        cancelWorkbenchHandlers.push(anamClient.registerToolCallHandler(toolName, {
                            onStart: async (payload) => {
                                const synchronizedTurns = transcriptRef.current.slice(-120) as AmyWorkbenchTurn[];
                                const pendingContent = currentMessageRef.current.trim();
                                const pendingTurn = pendingContent
                                    ? { role: transcriptRole(currentRoleRef.current), content: pendingContent } as AmyWorkbenchTurn
                                    : null;
                                if (
                                    pendingTurn
                                    && pendingTurn.role === 'user'
                                    && synchronizedTurns.at(-1)?.content !== pendingTurn.content
                                ) {
                                    synchronizedTurns.push(pendingTurn);
                                }
                                const topic = view === 'roadmap' && typeof payload.arguments?.topic === 'string'
                                    ? payload.arguments.topic.trim().slice(0, 2_000)
                                    : '';
                                const query = view === 'catalog' && typeof payload.arguments?.query === 'string'
                                    ? payload.arguments.query.trim().slice(0, 500)
                                    : '';
                                const receiptModel = buildAmyWorkbenchModel(synchronizedTurns, topic, query);
                                if (isMounted) {
                                    workbenchRevision += 1;
                                    setWorkbenchTurns([...synchronizedTurns]);
                                    if (view === 'roadmap') {
                                        setRoadmapTopic(topic);
                                    } else if (view === 'catalog') {
                                        setCatalogQuery(query);
                                    }
                                    setWorkbenchView(view);
                                    setWorkbenchOpen(true);
                                    await new Promise<void>((resolve) => {
                                        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
                                    });
                                }
                                return JSON.stringify({
                                status: 'view_rebuilt',
                                view,
                                revision: workbenchRevision,
                                currentSessionUserTurns: synchronizedTurns.filter((turn) => turn.role === 'user').length,
                                lane: receiptModel.lane,
                                visibleFacts: receiptModel.facts.map((fact) => `${fact.label}: ${fact.value}`),
                                instruction: `${confirmation} The client has committed this revision to the screen. Confirm only that the working view is open. Claim a named fact or track is visible only when it appears in visibleFacts.`,
                            });
                            },
                        }));
                    };

                    registerView('show_live_notes', 'notes', "Opened Amy's Live Notes using current-session conversation signals.");
                    registerView('show_session_brief', 'brief', "Opened Amy's Live Brief using current-session conversation signals.");
                    registerView('show_solution_roadmap', 'roadmap', "Opened Amy's illustrative Roadmap for the current conversation.");
                    registerView('show_visual_brief', 'visual', "Opened Amy's Visual Brief for the current conversation.");
                    registerView('show_solution_catalog', 'catalog', "Opened Amy's directional solution categories. Live pricing and inventory are not shown.");
                }
                if (evanPlannerEnabled) {
                    cancelWorkbenchHandlers.push(anamClient.registerToolCallHandler('show_move_planner', {
                        onStart: async (payload) => {
                            const requested = payload.arguments?.view;
                            const view: EvanMovePlannerView = requested === 'route'
                                || requested === 'inventory'
                                || requested === 'readiness'
                                ? requested
                                : 'brief';
                            const requestedRouteStops = parseEvanRouteToolStops(payload.arguments?.stops);
                            let routeStopsForReceipt = evanAddressStopsRef.current;

                            if (isMounted) {
                                setEvanPlannerView(view);
                                setEvanPlannerOpen(true);
                            }

                            if (requestedRouteStops.length) {
                                const pendingStops = routeToolStopsToMovePlanStops(requestedRouteStops);
                                routeStopsForReceipt = pendingStops;
                                evanAddressStopsRef.current = pendingStops;
                                if (isMounted) setEvanAddressStops(pendingStops);

                                try {
                                    const response = await fetch('/api/anam/evan/route-geocode', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        credentials: 'same-origin',
                                        cache: 'no-store',
                                        body: JSON.stringify({ stops: requestedRouteStops }),
                                    });
                                    const result = await response.json().catch(() => null) as { stops?: unknown } | null;
                                    const resolvedStops = response.ok ? parseResolvedEvanRouteStops(result?.stops) : [];
                                    routeStopsForReceipt = resolvedStops.length === requestedRouteStops.length
                                        ? resolvedStops
                                        : pendingStops.map((stop) => ({ ...stop, precision: 'unresolved' as const }));
                                } catch {
                                    routeStopsForReceipt = pendingStops.map((stop) => ({ ...stop, precision: 'unresolved' as const }));
                                }
                                evanAddressStopsRef.current = routeStopsForReceipt;
                                if (isMounted) setEvanAddressStops(routeStopsForReceipt);
                            }

                            if (isMounted) {
                                // Read the authoritative refs when React applies the update. This
                                // prevents an earlier tool snapshot from replacing a newer turn.
                                setWorkbenchTurns(() => snapshotEvanPlannerTurns());
                                await new Promise<void>((resolve) => {
                                    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
                                });
                            }

                            // Re-read after opening so speech chunks arriving during the tool call
                            // are included both in the visible planner and in the tool receipt.
                            const refreshedTurns = snapshotEvanPlannerTurns();
                            if (isMounted) setWorkbenchTurns(() => snapshotEvanPlannerTurns());
                            const receiptModel = buildEvanMovePlan(refreshedTurns, routeStopsForReceipt);
                            const streetPins = routeStopsForReceipt.filter((stop) => (
                                stop.precision === 'address' || stop.precision === 'address-range'
                            )).length;
                            const unresolvedAddresses = routeStopsForReceipt.filter((stop) => stop.precision === 'unresolved').length;
                            return JSON.stringify({
                                status: requestedRouteStops.length ? 'move_route_refreshed' : 'move_planner_opened',
                                view,
                                currentSessionUserTurns: refreshedTurns.filter((turn) => turn.role === 'user').length,
                                streetPins,
                                unresolvedAddresses,
                                visibleFacts: receiptModel.highlights.map((fact) => `${fact.label}: ${fact.value}`),
                                visibleStops: routeStopsForReceipt.map((stop, index) => `${index + 1}. ${stop.kind}: ${stop.displayAddress || stop.city} (${stop.precision || 'city'})`),
                                instruction: unresolvedAddresses
                                    ? 'The requested working Move Planner view is open, but one or more street addresses could not be verified. Say that briefly and ask the visitor to restate only the unresolved address. Do not claim the route is confirmed.'
                                    : streetPins
                                        ? 'The requested working Move Planner route is open with receipt-supported street-level pins. Confirm that briefly. Do not call it a confirmed driving route, quote, booking, or operational approval.'
                                        : 'The requested working Move Planner view is open. Confirm that briefly. Do not claim a quote, booking, confirmed route, or operational approval.',
                            });
                        },
                    }));
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
                        console.info(`[${memoryAgentLabel} Anam Memory] Live identity policy applied`, {
                            memoryUnlockAvailable: tokenPayload.memoryUnlockAvailable === true,
                            contentLogged: false,
                        });
                    } catch {
                        if (isMounted) {
                            setError(`${memoryAgentLabel} could not safely initialize returning memory. Please restart the session.`);
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
                            if (messageEvent.role === 'user') {
                                completedUserTurns = transcriptRef.current.filter((turn) => turn.role === 'user').length;
                            }
                        }
                        if (transcriptRole(messageEvent.role) === 'agent') {
                            evanCloseCoordinator?.completeFarewell();
                        }
                        currentMessageRef.current = '';
                        currentRoleRef.current = '';
                    }
                };

                const handleConnectionClosed = async (reason: ConnectionClosedCode) => {
                    if (closeHandled) return;
                    closeHandled = true;
                    evanCloseCoordinator?.dispose();
                    console.log('Anam connection closed');

                    if (sessionSpineActive) {
                        if (isMounted) setIsFinalizing(true);
                        try {
                            await completeOnce(requestedCloseReason ?? String(reason));
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
                                if (!preferredName || /^(?:user|visitor|guest|customer)$/i.test(preferredName) || !memoryAccessConfirmed) {
                                    throw new Error('Ask "What name would you like me to use?" and separately ask permission to check previous notes.');
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

                if (isDani) {
                    removeIdentityToolHandler = anamClient.registerToolCallHandler(
                        'confirm_dani_live_identity',
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
                                if (!preferredName || /^(?:user|visitor|guest|customer)$/i.test(preferredName) || !memoryAccessConfirmed) {
                                    throw new Error('Ask "What name would you like me to use?" and separately ask permission to check previous notes.');
                                }
                                if (!sessionSpineActive || !launchId || !providerSessionId || !bindingPromise) {
                                    throw new Error('The private Dani session is not ready. Continue the conversation and try once more.');
                                }
                                if (confirmedMemoryName) {
                                    return JSON.stringify({
                                        status: 'memory_already_unlocked',
                                        instruction: 'Use the Dani memory context already provided. Do not request contact details solely for memory.',
                                    });
                                }
                                await bindingPromise;
                                const result = await confirmDaniAnamLiveIdentity({
                                    launchId,
                                    sessionId: providerSessionId,
                                    preferredName,
                                    memoryAccessConfirmed: true,
                                });
                                confirmedMemoryName = result.preferredName;
                                anamClient.addContext(result.memoryContext);
                                console.info('[Dani Anam Memory] Returning context unlocked', {
                                    approvedSessionCount: result.memoryCount,
                                    identityContentLogged: false,
                                });
                                return JSON.stringify({
                                    status: 'memory_unlocked',
                                    memoryCount: result.memoryCount,
                                    instruction: result.memoryCount > 0
                                        ? 'In your next reply, say naturally that you found reviewed notes from an earlier conversation. Mention at most two or three distinctive earlier-session facts the visitor has not already supplied today, then ask whether they are still current. Use no more than two short sentences. Do not say memory unlocked or ask for contact details.'
                                        : 'Say plainly that no reviewed earlier-session notes were found, then continue naturally. Do not fill the gap with current-call facts or ask for contact details.',
                                });
                            },
                        },
                    );
                    removeEmailToolHandler = anamClient.registerToolCallHandler(
                        'send_dani_follow_up_email',
                        {
                            onStart: async payload => {
                                if (tokenPayload.agentMailAvailable !== true) {
                                    return JSON.stringify({
                                        status: 'email_unavailable',
                                        instruction: 'Say that no verified website email recap is available for this session. Do not ask for an address, claim anything was sent, or end the conversation.',
                                    });
                                }
                                if (typeof payload.arguments.userConfirmed !== 'boolean') {
                                    throw new Error('Use true to check the secure opt-in or false only when the visitor revokes it.');
                                }
                                if (!sessionSpineActive || !launchId || !providerSessionId || !bindingPromise) {
                                    throw new Error('The secure session is not ready. Continue the conversation and try once more.');
                                }
                                await bindingPromise;
                                const result = await setDaniAnamFollowUpPreference({
                                    launchId,
                                    sessionId: providerSessionId,
                                    userConfirmed: payload.arguments.userConfirmed,
                                });
                                console.info('[Dani Anam AgentMail] Three-message post-session intent confirmed', {
                                    status: result.status,
                                    duplicate: result.duplicate,
                                    contactContentLogged: false,
                                });
                                return JSON.stringify({
                                    status: result.status,
                                    queued: result.queued,
                                    sent: false,
                                    duplicate: result.duplicate,
                                    receiptId: result.receiptId,
                                    instruction: result.status === 'email_cancelled'
                                        ? 'Confirm briefly that the website follow-up was cancelled. Do not claim any message was sent and do not ask for another address.'
                                        : result.duplicate
                                            ? 'Confirm briefly that the Admin record, internal Call Summary, and visitor recap are already scheduled for after this website session. Do not say they were sent.'
                                            : 'Confirm briefly that the Admin record, internal Call Summary, and visitor recap are scheduled for after this website session and the final transcript is available. Do not say they were sent. Continue naturally.',
                                });
                            },
                        },
                    );
                }

                anamClient.addListener(AnamEvent.CONNECTION_ESTABLISHED, handleConnectionEstablished);
                if (isEvan) {
                    removeCloseToolHandler = anamClient.registerToolCallHandler(
                        'end_mullins_session',
                        {
                            onStart: async () => {
                                requestedCloseReason = 'user_requested_end';
                                const armed = evanCloseCoordinator?.arm() === true;
                                console.info('[Evan Anam] Farewell close armed', { armed });
                                return JSON.stringify({
                                    status: armed ? 'farewell_required' : 'farewell_already_armed',
                                    instruction: 'Say exactly one brief warm farewell now: "Thank you for speaking with Mullins Moving. Take care." Do not ask a question, add a recap, or mention ending the call. The browser will close after the farewell finishes.',
                                });
                            },
                        },
                    );
                    removeEmailToolHandler = anamClient.registerToolCallHandler(
                        'send_mullins_follow_up_email',
                        {
                            onStart: async payload => {
                                if (tokenPayload.agentMailAvailable !== true) {
                                    return JSON.stringify({
                                        status: 'email_unavailable',
                                        instruction: 'Say that email is temporarily unavailable. Do not claim anything was sent.',
                                    });
                                }
                                if (completedUserTurns < 1) {
                                    throw new Error('Continue the moving conversation before offering an email follow-up.');
                                }
                                if (payload.arguments.userConfirmed !== true) {
                                    throw new Error('Ask the visitor for explicit permission before scheduling the Mullins follow-up.');
                                }
                                if (!sessionSpineActive || !launchId || !providerSessionId || !bindingPromise) {
                                    throw new Error('The secure session is not ready. Continue the conversation and try once more.');
                                }
                                await bindingPromise;
                                const result = await sendAmyAnamFollowUpEmail({
                                    launchId, sessionId: providerSessionId, userConfirmed: true,
                                });
                                console.info('[Evan Anam AgentMail] Three-message post-session intent recorded', {
                                    status: result.status, duplicate: result.duplicate, contactContentLogged: false,
                                });
                                return JSON.stringify({
                                    status: result.status, queued: true, sent: false, duplicate: result.duplicate,
                                    receiptId: result.receiptId,
                                    instruction: result.duplicate
                                        ? 'Confirm briefly that the conversation recap is already scheduled for after the session. Do not say it was sent, and do not mention a quote or estimate being emailed.'
                                        : 'Confirm briefly that the conversation recap will be emailed after this session ends. If a quote, estimate, or walkthrough was discussed, say Mullins staff must separately review that request. Never say a quote, estimate, price, booking, or appointment will be emailed, included, prepared, sent, or confirmed. Continue naturally.',
                                });
                            },
                        },
                    );
                }

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
            window.removeEventListener('xagent:dani-request-end', handleDaniRequestedEnd);
            if (requestedCloseFallbackTimer !== null) {
                window.clearTimeout(requestedCloseFallbackTimer);
            }
            removeClientListeners?.();
            removeIdentityToolHandler?.();
            removeEmailToolHandler?.();
            removeCloseToolHandler?.();
            evanCloseCoordinator?.dispose();
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
    }, [personaId, sessionVariant, audioBridge, workbenchEnabled, evanPlannerEnabled]);

    return (
        <div className={`relative flex h-full w-full flex-col items-center justify-center ${evanPlannerEnabled ? 'bg-[#100718]' : personaId === DANI_PERSONA_ID ? 'bg-[#101713]' : 'bg-zinc-950'}`}>
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
                <div className={`absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm ${evanPlannerEnabled ? 'bg-[#100718]/88' : 'bg-zinc-950/50'}`}>
                    <div className="flex flex-col items-center space-y-4">
                        <div className={`h-12 w-12 animate-spin rounded-full border-4 ${evanPlannerEnabled ? 'border-[#5d24d6]/40 border-t-[#ffc857]' : 'border-zinc-700 border-t-white'}`}></div>
                        <p className={`animate-pulse text-sm uppercase tracking-widest ${evanPlannerEnabled ? 'text-[#ffdc8a]' : 'text-white'}`}>
                            {evanPlannerEnabled ? 'Preparing your Mullins concierge…' : 'Establishing Neural Link...'}
                        </p>
                    </div>
                </div>
            )}

            {isFinalizing && !error && (
                <div className={`absolute inset-0 z-30 flex items-center justify-center backdrop-blur-sm ${evanPlannerEnabled ? 'bg-[#100718]/80' : 'bg-zinc-950/70'}`}>
                    <div className="flex flex-col items-center space-y-3">
                        <div className="w-10 h-10 border-4 border-zinc-700 border-t-emerald-300 rounded-full animate-spin"></div>
                        <p className="text-emerald-200 text-xs tracking-widest uppercase">Securing session record...</p>
                    </div>
                </div>
            )}

            <div className={`flex h-full w-full items-center justify-center transition-[padding] duration-500 ease-out ${(workbenchEnabled && workbenchOpen) || (evanPlannerEnabled && evanPlannerOpen) ? 'lg:pr-[min(58vw,860px)]' : ''}`}>
                <video
                    ref={videoRef}
                    id="persona-video"
                    autoPlay
                    playsInline
                    className={`${evanPlannerEnabled ? 'aspect-video h-auto max-h-full w-full max-w-[1080px] rounded-2xl object-contain shadow-[0_28px_90px_rgba(0,0,0,.45)]' : personaId === DANI_PERSONA_ID ? 'h-full w-full scale-[.97] transform-gpu object-contain shadow-[0_24px_80px_rgba(0,0,0,.24)] md:scale-[.94] motion-reduce:transform-none' : 'h-full w-full object-contain'} transition-opacity duration-700 ${isConnecting ? 'opacity-0' : 'opacity-100'}`}
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

            {evanPlannerEnabled && !evanPlannerOpen && !error && !isConnecting && (
                <button
                    type="button"
                    onClick={() => setEvanPlannerOpen(true)}
                    className="absolute right-5 top-20 z-30 inline-flex items-center gap-2 rounded-xl border border-[#ffc857]/35 bg-[#5d24d6]/88 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-white shadow-2xl backdrop-blur-md transition hover:-translate-y-0.5 hover:border-[#ffc857]/70 hover:bg-[#6f34e8]"
                    data-testid="open-evan-move-planner"
                >
                    <span className="relative flex h-5 w-5 items-center justify-center">
                        <span className="absolute inset-0 animate-ping rounded-full bg-[#ffc857]/25" />
                        <Truck size={16} className="relative text-[#ffc857]" />
                    </span>
                    Live Move Planner
                </button>
            )}

            {evanPlannerEnabled && (
                <EvanMovePlanner
                    isOpen={evanPlannerOpen}
                    turns={workbenchTurns}
                    addressStops={evanAddressStops}
                    requestedView={evanPlannerView}
                    onClose={() => setEvanPlannerOpen(false)}
                />
            )}

            {/* Optional: Add a subtle animated grid overlay for the "HUD" feel */}
            <div className="pointer-events-none absolute inset-0 bg-white opacity-[0.03] mix-blend-overlay"></div>
        </div>
    );
}
