import type { Turn } from './handoff';

type Stream = Turn & { endOfSpeech:boolean; interrupted?:boolean };
type Trace = { event:'stream'|'history'; id:string; role:string; length:number; end?:boolean };

/** sendUserMessage writes the data channel, not MessageHistoryClient. Capture the
 * exact typed submission before dispatch. This is browser evidence, not a claim
 * of provider acceptance; the existing provider transcript gate still applies.
 * A rejected/unknown send is never automatically retried.
 */
export async function submitTypedTurn(turn:Turn, persist:(t:Turn)=>Promise<unknown>, send:(t:Turn)=>void) {
    await persist(turn);
    send(turn);
}

/** SDK 4.20: user events are whole messages; persona events are incremental.
 * History is emitted after a speech-end event. Never use a second speech-end
 * whitelist to discard user entries from that history. Drafts are display only.
 */
export function liveTranscript() {
    const drafts=new Map<string,Turn>(), finalized=new Map<string,Turn>();
    const personaEnded=new Set<string>();
    const trace:Trace[]=[];
    function record(event:Trace) { trace.push(event); if(trace.length>200)trace.shift(); }
    function complete(turn:Turn) {
        const prior=finalized.get(turn.id);
        if(prior) {
            if(prior.role!==turn.role || prior.content!==turn.content)throw new Error('SDK finalized transcript changed; reconcile original provider evidence');
            return [];
        }
        if(!turn.content.trim())return [];
        finalized.set(turn.id,{...turn});drafts.delete(turn.id);return [{...turn}];
    }
    return {
        stream(e:Stream):Turn[] {
            record({event:'stream',id:e.id,role:e.role,length:e.content.length,end:e.endOfSpeech});
            if(e.role==='user')return complete({id:e.id,role:e.role,content:e.content});
            if(finalized.has(e.id))return [];
            const prior=drafts.get(e.id);
            drafts.set(e.id,{id:e.id,role:e.role,content:(prior?.content||'')+e.content});
            if(e.endOfSpeech)personaEnded.add(e.id);
            return []; // even endOfSpeech waits for the SDK's assembled history
        },
        history(messages:Turn[]):Turn[] {
            const ready:Turn[]=[];
            for(const m of messages) {
                record({event:'history',id:m.id,role:m.role,length:m.content.length});
                if(m.role==='persona'&&!personaEnded.has(m.id))continue;
                ready.push(...complete({id:m.id,role:m.role,content:m.content}));
            }
            return ready;
        },
        drafts:()=>Array.from(drafts.values()),
        trace:()=>trace.slice(),
    };
}
