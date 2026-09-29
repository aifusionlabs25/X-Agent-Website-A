// Synthetic, owner-authorized comparison diagnostics only. No tokens/headers.
export type TraceEntry={sequence:number;at:string;kind:string;[key:string]:unknown};
export function comparisonTrace(arm:string){
    const entries:TraceEntry[]=[],calls=new Set<string>();
    let bytes=0;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const key='james-planner-comparison-trace-'+arm;
    const flush=()=>sessionStorage.setItem(key,JSON.stringify(entries));
    const record=(kind:string,data:Record<string,unknown>={})=>{
        const entry={sequence:entries.length+1,at:new Date().toISOString(),kind,...data};
        const size=JSON.stringify(entry).length;
        if(entries.length>=1200||bytes+size>2*1024*1024)return;
        bytes+=size;entries.push(entry);
        clearTimeout(timer);timer=setTimeout(flush,100);
    };
    const hash=(kind:string,text:string,data:Record<string,unknown>={})=>{
        void crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)).then(b=>record(kind,{...data,sha256:[...new Uint8Array(b)].map(v=>v.toString(16).padStart(2,'0')).join('')}));
    };
    const original=RTCDataChannel.prototype.send;
    // Observe native send synchronously and forward the identical bytes. Do not
    // add a queue, wait, retry, fake acknowledgment or alternative transport.
    const wrapped=function(this:RTCDataChannel,data:string|Blob|ArrayBuffer|ArrayBufferView<ArrayBuffer>){
        let matched:{tool_call_id:string;session_id:string}|null=null;
        if(typeof data==='string')try{const p=JSON.parse(data);if(p.message_type==='tool_result'&&calls.has(p.tool_call_id))matched=p;}catch{}
        if(matched)record('DATA_CHANNEL_SEND_ATTEMPT',{toolCallId:matched.tool_call_id,providerId:matched.session_id,readyState:this.readyState,wireText:data});
        try{
            Reflect.apply(original,this,[data]);
            if(matched)record('DATA_CHANNEL_SEND_RETURNED',{toolCallId:matched.tool_call_id,providerConsumption:'NOT_OBSERVABLE'});
        }catch(error){
            if(matched)record('DATA_CHANNEL_SEND_THROWN',{toolCallId:matched.tool_call_id,errorCategory:error instanceof Error?error.name:'UNKNOWN'});
            throw error;
        }
    };
    RTCDataChannel.prototype.send=wrapped;
    return {record,hash,beginCall:(id:string)=>calls.add(id),flush,
        snapshot:()=>JSON.stringify(entries,null,2),
        restore:()=>{if(RTCDataChannel.prototype.send===wrapped)RTCDataChannel.prototype.send=original;clearTimeout(timer);flush();}};
}
