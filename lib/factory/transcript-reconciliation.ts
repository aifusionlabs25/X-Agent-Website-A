/** Compare original evidence; never rewrite it or equate a substring with a turn. */
import { createHash } from 'node:crypto';
import type { Turn } from './handoff';

export type ProviderMessage = {role:'user'|'persona';message:string;[key:string]:unknown};
export type ProviderTranscript = {
    sessionId:string;transcriptsEnabled:boolean;totalMessages:number;messages:ProviderMessage[];
    [key:string]:unknown;
};
type Span = {message_index:number;start:number;end:number;local_start:number;local_end:number};
type Boundary = {local_offset:number;between_provider_messages:[number,number];text:' '};
export type TranscriptLink = {
    local_turn_id:string;local_turn_index:number;provider_spans:Span[];provider_boundary_spaces:Boundary[];
};
export type Reconciliation = {
    contract:'factory.transcript-reconciliation.v0.1';verified:boolean;reason:string;
    provider_session_id:string;local_turns_sha256:string;provider_transcript_sha256:string;
    links:TranscriptLink[];
    aliases:Array<{local_turn_id:string;local_turn_index:number;provider_message_index:number;previous_message_sha256:string}>;
    provider_only_message_indices:number[];unmatched_local_turn_ids:string[];
    joining_rule:'ONE_LITERAL_SPACE_BETWEEN_CONTIGUOUS_MESSAGES_ONLY';
};
type Row={index:number;id:string;text:string};
type Match={local:Row[];provider:Row[]};
type Path={matches:Match[];providerOnly:number[]};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validTranscript=(t:ProviderTranscript|undefined,id:string):t is ProviderTranscript=>Boolean(t
    &&t.sessionId===id&&t.transcriptsEnabled===true&&Array.isArray(t.messages)&&t.messages.length<=200
    &&t.totalMessages===t.messages.length&&t.messages.every(p=>p&&['user','persona'].includes(p.role)
        &&typeof p.message==='string'&&p.message.length<=8000));

function contiguous(rows:Row[],at:number) {return at>0&&rows[at]?.index===rows[at-1].index+1;}

/** Smallest exact whole-message grouping; a changed character cannot be repaired by grouping. */
function matchGroup(local:Row[],provider:Row[],li:number,pi:number):Match|null {
    let le=li,pe=pi,a=local[li].text,b=provider[pi].text;
    while(true) {
        if(a===b)return {local:local.slice(li,le+1),provider:provider.slice(pi,pe+1)};
        if(a.startsWith(b)&&contiguous(provider,pe+1))b+=' '+provider[++pe].text;
        else if(b.startsWith(a)&&contiguous(local,le+1))a+=' '+local[++le].text;
        else return null;
    }
}

function ranges(rows:Row[]) {
    let offset=0;
    return rows.map((row,i)=>{const start=offset;offset+=row.text.length+(i<rows.length-1?1:0);return {row,start,end:start+row.text.length};});
}

function linksFor(match:Match):TranscriptLink[] {
    const source=ranges(match.provider);
    return ranges(match.local).map(({row,start,end})=>{
        const provider_spans:Span[]=[],provider_boundary_spaces:Boundary[]=[];
        source.forEach((p,i)=>{
            const lo=Math.max(start,p.start),hi=Math.min(end,p.end);
            if(lo<hi)provider_spans.push({message_index:p.row.index,start:lo-p.start,end:hi-p.start,local_start:lo-start,local_end:hi-start});
            if(i<source.length-1&&p.end>=start&&p.end<end)
                provider_boundary_spaces.push({local_offset:p.end-start,between_provider_messages:[p.row.index,source[i+1].row.index],text:' '});
        });
        return {local_turn_id:row.id,local_turn_index:row.index,provider_spans,provider_boundary_spaces};
    });
}

/**
 * Server must first authenticate the provider session/persona/launch binding.
 * This pure verifier checks the exact session ID again, original visitor text,
 * occurrence counts and ordering. Only message-boundary spaces may be joined.
 * Provider-only whole turns stay explicit so the caller can retain them.
 */
export function reconcileTranscript(input:{provider_session_id:string;turns:Turn[];transcript:ProviderTranscript;previous_transcript?:ProviderTranscript}):Reconciliation {
    const {provider_session_id:sid,turns,transcript,previous_transcript:previous}=input;
    const base:Reconciliation={contract:'factory.transcript-reconciliation.v0.1',verified:false,reason:'INVALID_TRANSCRIPT',
        provider_session_id:sid,local_turns_sha256:hash(turns),provider_transcript_sha256:hash(transcript),
        links:[],aliases:[],provider_only_message_indices:[],unmatched_local_turn_ids:[],
        joining_rule:'ONE_LITERAL_SPACE_BETWEEN_CONTIGUOUS_MESSAGES_ONLY'};
    if(typeof sid!=='string'||!sid||!validTranscript(transcript,sid))return base;
    if(!Array.isArray(turns)||turns.length>200||new Set(turns.map(t=>t?.id)).size!==turns.length
        ||turns.some(t=>!t||typeof t.id!=='string'||!t.id||!['user','persona'].includes(t.role)
            ||typeof t.content!=='string'||!t.content.trim()||t.content.length>8000))return base;
    const local:Row[]=[];
    for(let i=0;i<turns.length;i++) {
        const t=turns[i];
        if(t.id.startsWith('provider-capture:')) {
            const match=/^provider-capture:(\d+):([a-f0-9]{12})$/.exec(t.id),index=match?Number(match[1]):-1;
            const prior=validTranscript(previous,sid)?previous.messages[index]:undefined,current=transcript.messages[index];
            // A prefix is never authority to ignore evidence. Verify the server's
            // original capture ID and both same-session source rows first.
            if(!match||!prior||!current||hash(prior).slice(0,12)!==match[2]
                ||prior.role!==t.role||prior.message!==t.content||current.role!==t.role||current.message!==t.content)
                return {...base,reason:'INVALID_PROVIDER_CAPTURE',unmatched_local_turn_ids:[t.id]};
            base.aliases.push({local_turn_id:t.id,local_turn_index:i,provider_message_index:index,previous_message_sha256:hash(prior)});
        } else if(t.role==='user')local.push({index:i,id:t.id,text:t.content});
    }
    const provider=transcript.messages.flatMap((p,index)=>p.role==='user'&&p.message.trim()?[{index,id:String(index),text:p.message}]:[]);
    const memo=new Map<string,Path[]>();
    const solve=(li:number,pi:number):Path[]=>{
        const key=li+':'+pi,cached=memo.get(key);if(cached)return cached;
        if(li===local.length)return [{matches:[],providerOnly:provider.slice(pi).map(p=>p.index)}];
        if(pi===provider.length)return [];
        const found:Path[]=[],group=matchGroup(local,provider,li,pi);
        if(group)for(const next of solve(li+group.local.length,pi+group.provider.length))
            found.push({matches:[group,...next.matches],providerOnly:next.providerOnly});
        // Only complete provider turns can be recovered; never skip a word,
        // a negation or a suffix within a purportedly matching message.
        if(found.length<2)for(const next of solve(li,pi+1)) {
            found.push({matches:next.matches,providerOnly:[provider[pi].index,...next.providerOnly]});
            if(found.length===2)break;
        }
        const bounded=found.slice(0,2);memo.set(key,bounded);return bounded;
    };
    const paths=solve(0,0);
    if(paths.length!==1)return {...base,reason:paths.length?'AMBIGUOUS_ALIGNMENT':'LOCAL_EVIDENCE_NOT_FOUND',unmatched_local_turn_ids:local.map(t=>t.id)};
    const result=paths[0];
    return {...base,verified:true,reason:'VERIFIED_EXACT_ORDERED_SPANS',links:result.matches.flatMap(linksFor),provider_only_message_indices:result.providerOnly};
}
