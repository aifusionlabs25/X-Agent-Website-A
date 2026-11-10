/** Browser-side observation only. addContext returning does NOT establish a
 * data-channel send, provider receipt, or model consumption. Never retry here. */
export type ContextKind='COLLECTION'|'VISITOR_REFERENCE'|'HANDOFF_REQUEST'|'VISITOR_EXIT';
export type ContextSendEvent={attempt_id:string;method:'addContext';kind:ContextKind;
    visitor_message_id:string|null;payload:string;phase:'INVOKED'|'RETURNED'|'THREW';at:string};
export type ContextSendReceipt=ContextSendEvent & {local_session_id:string;provider_session_id:string;launch_label:string};
export const contextAssurance='CLIENT_REPORTED_SDK_CALL_NOT_TRANSPORT_ACK_OR_MODEL_CONSUMPTION' as const;
export function contextSendTracker(options:{send:(text:string)=>void;
    report:(event:ContextSendEvent)=>Promise<unknown>|void;id?:()=>string;now?:()=>string}) {
    const events:ContextSendEvent[]=[];let reportFailures=0;
    function emit(event:ContextSendEvent) {
        events.push({...event});
        try{Promise.resolve(options.report({...event})).catch(()=>{reportFailures++;});}
        catch{reportFailures++;}
    }
    return {
        send(kind:ContextKind,visitor_message_id:string|null,payload:string) {
            if(events.length>=512||!payload.trim()||payload.length>40000)throw new Error('Context evidence bound reached');
            const now=options.now||(()=>new Date().toISOString());
            const base={attempt_id:(options.id||(()=>crypto.randomUUID()))(),method:'addContext' as const,
                kind,visitor_message_id,payload};
            const at=now();let failed=false,error:unknown;
            try{options.send(payload);}catch(e){failed=true;error=e;}
            // Log an actual invocation, including a synchronous throw. Reporting
            // is best effort and must not retry the SDK or interfere with close.
            emit({...base,phase:'INVOKED',at});
            emit({...base,phase:failed?'THREW':'RETURNED',at:now()});
            if(failed)throw error;
        },
        snapshot:()=>({events:events.map(e=>({...e})),report_failures:reportFailures,assurance:contextAssurance}),
    };
}
export type ContextSendTracker=ReturnType<typeof contextSendTracker>;
