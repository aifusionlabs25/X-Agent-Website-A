'use client';

import { useState, useRef, useEffect } from 'react';
import { useAnamQaSession } from '@/hooks/useAnamQaSession';
import TranscriptPanel from './TranscriptPanel';
import { Send, Square, RefreshCcw, Hand } from 'lucide-react';

interface AgentQaChatProps {
    personaId: string;
    agentName: string;
    sessionVariant?: string;
}

export default function AgentQaChat({ personaId, agentName, sessionVariant }: AgentQaChatProps) {
    const [inputValue, setInputValue] = useState('');
    const [isSending, setIsSending] = useState(false);
    
    const { 
        connectionState, 
        messages, 
        connect, 
        disconnect, 
        sendUserMessage, 
        interrupt,
        clearMessages
    } = useAnamQaSession({ personaId, sessionVariant });

    const hasAttemptedConnect = useRef(false);

    // Connect automatically on mount in QA mode
    useEffect(() => {
        if (!hasAttemptedConnect.current && connectionState === 'idle') {
            hasAttemptedConnect.current = true;
            connect('qa-persona-video');
        }
        return () => {
            disconnect();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [personaId, sessionVariant]);

    const handleSend = async () => {
        if (!inputValue.trim() || connectionState !== 'streaming' || isSending) return;
        
        const textToSubmit = inputValue.trim();
        setIsSending(true);
        setInputValue(''); // Optimistic clear

        try {
            await sendUserMessage(textToSubmit);
        } finally {
            setIsSending(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div 
            className="flex flex-col md:flex-row w-full h-full max-h-screen bg-black overflow-hidden font-sans"
            data-testid="qa-chat-root"
        >
            {/* LEFT SIDE: Video Player & Controls */}
            <div className="flex-1 md:w-1/2 flex flex-col p-4 border-r border-zinc-800">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-white font-bold tracking-tight">System Testing: {agentName}</h2>
                        <div className="flex items-center gap-2 mt-1">
                            <div className={`w-2 h-2 rounded-full ${
                                connectionState === 'streaming' ? 'bg-green-500 animate-pulse' :
                                connectionState === 'connecting' ? 'bg-yellow-500 animate-pulse' :
                                connectionState === 'error' ? 'bg-red-500' : 'bg-zinc-600'
                            }`} />
                            <span 
                                className="text-xs text-zinc-400 font-mono uppercase tracking-wider"
                                data-testid="qa-connection-state"
                            >
                                {connectionState}
                            </span>
                        </div>
                    </div>
                    <div className="bg-red-900/40 text-red-400 border border-red-900 px-3 py-1 rounded text-xs font-bold uppercase tracking-widest">
                        QA MODE ENABLED
                    </div>
                </div>

                <div className="relative w-full aspect-video bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 flex items-center justify-center">
                     <video
                        id="qa-persona-video"
                        autoPlay
                        playsInline
                        className={`w-full h-full object-contain transition-opacity duration-300 ${connectionState === 'streaming' ? 'opacity-100' : 'opacity-0'}`}
                    />
                    {connectionState === 'connecting' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80">
                            <div className="w-8 h-8 border-2 border-zinc-600 border-t-zinc-200 rounded-full animate-spin" />
                        </div>
                    )}
                </div>

                <div className="mt-6 grid grid-cols-2 gap-3">
                    <button
                        onClick={() => connectionState === 'streaming' ? disconnect() : connect('qa-persona-video')}
                        className={`flex items-center justify-center gap-2 px-4 py-2 rounded font-semibold text-sm transition-colors ${
                            connectionState === 'streaming' 
                                ? 'bg-red-600/20 text-red-500 hover:bg-red-600/30' 
                                : 'bg-green-600/20 text-green-500 hover:bg-green-600/30'
                        }`}
                    >
                        <Square size={16} />
                        {connectionState === 'streaming' ? 'End Session' : 'Start Session'}
                    </button>
                    
                    <button
                        onClick={interrupt}
                        disabled={connectionState !== 'streaming'}
                        title="Interrupt Persona Speaking"
                        data-testid="qa-interrupt"
                        className="flex items-center justify-center gap-2 px-4 py-2 rounded font-semibold text-sm transition-colors bg-orange-600/20 text-orange-500 hover:bg-orange-600/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Hand size={16} />
                        Interrupt
                    </button>
                </div>
                
                <div className="mt-4 p-4 bg-yellow-950/20 border border-yellow-900/50 rounded-md">
                   <p className="text-yellow-600/80 text-xs font-mono leading-relaxed">
                       <strong>NOTE:</strong> Microphone capture is disabled at the SDK level setting <code>disableInputAudio: true</code>. Use the chat panel to interact.
                   </p>
                </div>
            </div>

            {/* RIGHT SIDE: Chat & Transcript */}
            <div className="flex-1 md:w-1/2 flex flex-col p-4 bg-zinc-950">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-zinc-300 font-semibold text-sm uppercase tracking-widest">Transcript Log</h3>
                    <button 
                         onClick={clearMessages}
                         data-testid="qa-clear"
                         className="text-zinc-500 hover:text-white transition-colors"
                         title="Clear Transcript UI"
                    >
                        <RefreshCcw size={16} />
                    </button>
                </div>

                <TranscriptPanel messages={messages} />

                <div className="mt-4 flex gap-2">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={connectionState === 'streaming' ? "Type message to simulate user input..." : "Wait for connection..."}
                        disabled={connectionState !== 'streaming' || isSending}
                        data-testid="qa-input"
                        className="flex-1 bg-zinc-900 border border-zinc-700 text-white rounded px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        autoComplete="off"
                    />
                    <button
                        onClick={handleSend}
                        disabled={!inputValue.trim() || connectionState !== 'streaming' || isSending}
                        data-testid="qa-send"
                        className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded px-6 py-3 flex items-center justify-center transition-colors"
                    >
                        <Send size={18} className={isSending ? 'animate-pulse' : ''} />
                    </button>
                </div>
            </div>
        </div>
    );
}
