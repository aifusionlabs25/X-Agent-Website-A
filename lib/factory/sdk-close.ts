/** Client instrumentation, not provider authentication or release evidence.
 * A receipt is emitted only after the SDK function has actually been invoked.
 * Telemetry failures never block cleanup, retry the SDK, or imply CLOSED.
 */
export type CloseReason='VISITOR_EXIT'|'OWNER_FINISH'|'UNMOUNT'|'BIND_FAILED';
export type SdkCloseEvent={invocation_id:string;method:'stopStreaming';reason:CloseReason;
    phase:'INVOKED'|'RESOLVED'|'REJECTED';at:string};
export type SdkCloseReceipt=SdkCloseEvent & {local_session_id:string;launch_label:string;provider_session_id:string|null};
export function sdkCloseTracker(options:{stop:()=>Promise<void>;report:(event:SdkCloseEvent)=>Promise<unknown>|void;
    id?:()=>string;now?:()=>string}) {
    let pending:Promise<void>|null=null,invocations=0,reportFailures=0;
    const events:SdkCloseEvent[]=[];
    function emit(event:SdkCloseEvent) {
        events.push({...event});
        try {Promise.resolve(options.report({...event})).catch(()=>{reportFailures++;});}
        catch {reportFailures++;}
    }
    function close(reason:CloseReason):Promise<void> {
        if(pending)return pending;
        // Install the promise before any SDK/report callback can re-enter.
        pending=Promise.resolve().then(async()=>{
            const invocation_id=(options.id||(()=>crypto.randomUUID()))();
            const now=options.now||(()=>new Date().toISOString());
            const event={invocation_id,method:'stopStreaming' as const,reason};
            let result:Promise<void>|undefined,failed=false,error:unknown;
            invocations++;
            try {result=options.stop();} catch(e) {failed=true;error=e;}
            // This records an actual invocation, including a synchronous throw,
            // rather than an intention written before calling the SDK.
            emit({...event,phase:'INVOKED',at:now()});
            try {
                if(failed)throw error;
                await result;
                emit({...event,phase:'RESOLVED',at:now()});
            } catch(e) {emit({...event,phase:'REJECTED',at:now()});throw e;}
        });
        return pending;
    }
    return {close,snapshot:()=>({events:events.map(e=>({...e})),invocations,report_failures:reportFailures,
        assurance:'CLIENT_INSTRUMENTATION_NOT_PROVIDER_RELEASE' as const})};
}
export type SdkCloseTracker=ReturnType<typeof sdkCloseTracker>;
