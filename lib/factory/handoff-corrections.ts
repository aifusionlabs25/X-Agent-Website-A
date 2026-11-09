import type {Turn} from './handoff';

const words=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const correctionStart=/^(?:(?:(?:one|a|small|quick)\s+)?correction\b|actually\b|(?:just\s+)?to correct\b|i (?:meant|mean|need to correct)\b)/i;
const uncertainOrNarrated=/\b(?:if|maybe|perhaps|might|unsure|uncertain|think|guess|said|says|told|quoted|wrote|asked)\b/i;
const scaffold=new Set(['we','i','you','they','it','our','my','the','a','an','there','is','are','was','were','has','have','had','of','to','be','now','actually','correction','one','quick','small','just','correct']);
const countLabels=new Set(['count','total','number','amount','size']);
const clauseBoundary=/\b(?:and|but|with|for|in|on|at|from|not)\b/i;

/** A number alone is not a fact identity. Require a shared concrete unit or
 * subject, e.g. staff/count-of-staff. Other counts may coexist only when their
 * units are distinct; ambiguous occurrences/subjects remain owner-review work.
 * Detection only: neither spelling nor the retained evidence is rewritten. */
function numericSubject(clause:string,number:string):string[] {
    const matches=[...clause.matchAll(/(?<![\w.])\d+(?!\w|\.\d)/g)];
    const targets=matches.map((m,index)=>({m,index})).filter(({m})=>m[0]===number);
    if(targets.length!==1)return [];
    const subject=(index:number):string[]=>{
        const m=matches[index],previous=matches[index-1],next=matches[index+1];
        const before=clause.slice(previous?previous.index!+previous[0].length:0,m.index);
        const after=clause.slice(m.index!+m[0].length,next?.index);
        if(/\b(?:not|no|never|without|cannot|can't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|haven't|hasn't|hadn't)\b/i.test(before.replace(/’/g,"'")))return [];
        const afterClause=after.split(clauseBoundary)[0];
        const afterWords=words(afterClause).split(' ').filter(Boolean);
        // The immediate unit is stronger than incidental later words ("available",
        // "team", etc.). A second number cannot lend its unit to this one.
        if(afterWords.length&&!scaffold.has(afterWords[0]))return [afterWords[0]];
        const beforeWords=words(before.split(clauseBoundary).at(-1)||'').split(' ').filter(w=>w&&!scaffold.has(w));
        // Retain only the nearest concrete subject, not an earlier count's unit.
        return beforeWords.filter(w=>!countLabels.has(w)).slice(-1);
    };
    const target=targets[0].index,unit=subject(target);
    if(!unit.length||matches.some((_,index)=>index!==target&&subject(index).some(w=>unit.includes(w))))return [];
    return unit;
}
function numericContradiction(evidence:string,beforeNot:string,negated:string):boolean {
    if(!/^\d+$/.test(negated))return false;
    const replacementClause=beforeNot.split(/[;.!?]/).at(-1)||'';
    const replacements=[...replacementClause.matchAll(/(?<![\w.])\d+(?!\w|\.\d)/g)];
    if(replacements.length!==1||replacements[0][0]===negated)return false;
    const replacementSubject=numericSubject(replacementClause,replacements[0][0]);
    if(!replacementSubject.length)return false;
    if([...evidence.matchAll(/(?<![\w.])\d+(?!\w|\.\d)/g)].filter(m=>m[0]===negated).length!==1)return false;
    const clauses=evidence.split(/[;.!?,]|\b(?:and|but)\b/i);
    const matching=clauses.filter(clause=>numericSubject(clause,negated).some(w=>replacementSubject.includes(w)));
    return matching.length===1;
}

/** Conservative explicit contradiction guard, not a general semantic classifier.
 * Reject a prior positive quote when a later visitor correction explicitly
 * negates its multiword phrase or same-subject numeric count. Never rewrite evidence or select a
 * replacement fact. Unrecognized corrections still require owner review. */
export function contradictingCorrection(turns:Turn[],sourceId:string,evidence:string):Turn|null {
    const source=turns.findIndex(t=>t.id===sourceId&&t.role==='user');
    if(source<0)return null;
    const original=' '+words(evidence)+' ';
    for(const turn of turns.slice(source+1)) {
        if(turn.role!=='user'||/["“”`]/.test(turn.content))continue;
        if(!correctionStart.test(turn.content.trim()))continue;
        for(const match of turn.content.matchAll(/\bnot\s+([^.!?;,]+)(?:[.!?;,]|$)/gi)) {
            const statement=turn.content.slice(0,match.index!+match[0].length);
            if(statement.includes('?')||uncertainOrNarrated.test(statement))continue;
            const phrase=words(match[1]).replace(/^(?:the|a|an|our|my) /,'');
            if(numericContradiction(evidence,turn.content.slice(0,match.index),phrase))return turn;
            if(phrase.split(' ').length<2)continue;
            if(original.includes(' '+phrase+' ')&&!original.includes(' not '+phrase+' ')&&!original.includes(' not the '+phrase+' '))return turn;
        }
    }
    return null;
}
