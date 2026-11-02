import type {Turn} from './handoff';

/** Conservative explicit contradiction guard, not a general semantic classifier.
 * Reject a prior positive quote when a later visitor correction explicitly
 * negates a multiword phrase it contains. Never rewrite evidence or select a
 * replacement fact. Unrecognized corrections still require owner review. */
export function contradictingCorrection(turns:Turn[],sourceId:string,evidence:string):Turn|null {
    const source=turns.findIndex(t=>t.id===sourceId&&t.role==='user');
    if(source<0)return null;
    const words=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    const original=' '+words(evidence)+' ';
    for(const turn of turns.slice(source+1)) {
        if(turn.role!=='user'||/["“”`]/.test(turn.content))continue;
        if(!/^(?:actually\b|correction\b|to correct\b|i (?:meant|mean)\b)/i.test(turn.content.trim()))continue;
        for(const match of turn.content.matchAll(/\bnot\s+([^.!?;,]+)(?:[.!?;,]|$)/gi)) {
            const phrase=words(match[1]).replace(/^(?:the|a|an|our|my) /,'');
            if(phrase.split(' ').length<2)continue;
            if(original.includes(' '+phrase+' ')&&!original.includes(' not '+phrase+' ')&&!original.includes(' not the '+phrase+' '))return turn;
        }
    }
    return null;
}
