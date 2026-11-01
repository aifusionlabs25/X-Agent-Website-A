import { digest,type Turn,type Proposal } from './handoff.ts';

export type FragmentBinding={index:number;original_message_id:string;original_quote:string;
    boundary_rule:'ONE_LITERAL_SPACE';segments:Array<{message_id:string;start:number;end:number;source_sha256:string}>};

/** Project a complete quote into separate exact evidence rows, never fabricate
 * a combined source turn. Only the supplied SDK visitor ID can anchor this
 * path. Every consecutive fragment must be copied in full; no trimming,
 * skipped turns, assistant text, partial fragments or guessed references. */
export function projectSpeechFragments(p:Proposal,turns:Turn[],index:number) {
    const start=turns.findIndex(t=>t.id===p.visitor_message_id&&t.role==='user');
    if(start<0||!p.visitor_message_id.startsWith('user::'))return null;
    const fragments:Turn[]=[];let joined='';
    for(let i=start;i<turns.length&&fragments.length<8;i++) {
        const t=turns[i];
        if(t.role!=='user'||!t.id.startsWith('user::')||!t.content.trim())break;
        joined+=(fragments.length?' ':'')+t.content;fragments.push(t);
        if(!p.evidence.startsWith(joined))break;
        if(joined===p.evidence&&fragments.length>1) {
            const binding:FragmentBinding={index,original_message_id:p.visitor_message_id,original_quote:p.evidence,
                boundary_rule:'ONE_LITERAL_SPACE',segments:fragments.map(t=>({message_id:t.id,start:0,end:t.content.length,source_sha256:digest(t)}))};
            return {binding,proposals:fragments.map(t=>({...p,visitor_message_id:t.id,evidence:t.content,value:t.content}))};
        }
    }
    return null;
}
