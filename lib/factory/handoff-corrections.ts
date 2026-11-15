import type {Turn} from './handoff';
import {countView} from './handoff-counts.ts';
import {isHandoffAmendmentCommand} from './handoff-request.ts';

const words=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const correctionStart=/^(?:(?:(?:one|1|a|small|quick)\s+)?correction\b|actually\b|(?:just\s+)?to correct\b|i (?:meant|mean|need to correct)\b)/i;
const uncertainOrNarrated=/\b(?:if|maybe|perhaps|might|unsure|uncertain|think|guess|said|says|told|quoted|wrote|asked)\b/i;
const disclaimedPrefix=/\b(?:no|not|never|without|cannot|can['’]t|don['’]t|doesn['’]t|didn['’]t|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|won['’]t|wouldn['’]t|shouldn['’]t|ignore|disregard|deny|reject|pretend|imagine|suppose|example|hypothetical|say|saying|quote|quoting)\b/i;
const scaffold=new Set(['we','i','you','they','it','our','my','the','a','an','there','is','are','was','were','has','have','had','of','to','be','now','actually','correction','one','quick','small','just','correct']);
const countLabels=new Set(['count','total','number','amount','size']);
const clauseBoundary=/\b(?:and|but|with|for|in|on|at|from|not)\b/i;

/** Consent or another affirmative clause may precede an explicit correction.
 * Only punctuation/coordinators open this additional path; arbitrary substrings
 * do not. Keep the complete prefix available to uncertainty/narration checks,
 * and never treat a negation before the marker as part of its correction. */
function correctionStarts(raw:string):number[] {
    const starts=correctionStart.test(raw.trimStart())?[0]:[];
    for(const boundary of raw.matchAll(/[,;.!\n]\s*|\b(?:and|but)\s+/gi)) {
        const start=boundary.index!+boundary[0].length,prefix=raw.slice(0,start);
        if(correctionStart.test(raw.slice(start))&&!/[?:：]/.test(prefix)
            &&!uncertainOrNarrated.test(prefix)&&!disclaimedPrefix.test(prefix))starts.push(start);
    }
    return starts;
}

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
    const normalizedEvidence=countView(evidence),original=' '+words(normalizedEvidence)+' ';
    for(const turn of turns.slice(source+1)) {
        if(turn.role!=='user'||/["“”`]|(?:^|[\s([{])['‘]/u.test(turn.content))continue;
        const content=countView(turn.content),starts=correctionStarts(content);
        for(const match of content.matchAll(/\bnot\s+([^.!?;,]+)(?:[.!?;,]|$)/gi)) {
            const statement=content.slice(0,match.index!+match[0].length);
            if(statement.includes('?')||uncertainOrNarrated.test(statement))continue;
            const phrase=words(match[1]).replace(/^(?:the|a|an|our|my) /,'');
            const beforeNot=content.slice(0,match.index);
            const explicitStart=starts.some(start=>start<match.index!);
            // A sentence beginning with a direct numeric assertion ("4 staff,
            // not 6") need not use a ceremonial correction prefix to block a
            // stale count. Keep narration/negation safeguards; arbitrary embedded
            // contrasts remain unsupported. Detection is not replacement authority.
            const clause=beforeNot.split(/[;.!?:：]/).at(-1)||'';
            const colon=beforeNot.search(/[:：]/);
            const amendmentEnvelope=colon>=0&&isHandoffAmendmentCommand(beforeNot.slice(0,colon));
            const directCount=(/^\s*(?:(?:it|this|that)\s+is\s+)?\d+\s+\p{L}/iu.test(clause)
                ||amendmentEnvelope&&/^\s*(?:(?:(?:we|i|they)\s+(?:have|are)|there\s+are)\s+)?\d+\s+\p{L}/iu.test(clause))
                &&!beforeNot.includes('?')&&(colon<0||amendmentEnvelope)
                &&!starts.some(start=>start>match.index!)
                &&!disclaimedPrefix.test(beforeNot)
                &&!/\b(?:reads?|states?|describes?|reports?)\b/i.test(beforeNot);
            if((explicitStart||directCount)&&numericContradiction(normalizedEvidence,beforeNot,phrase))return turn;
            if(!explicitStart)continue;
            if(phrase.split(' ').length<2)continue;
            if(original.includes(' '+phrase+' ')&&!original.includes(' not '+phrase+' ')&&!original.includes(' not the '+phrase+' '))return turn;
        }
    }
    return null;
}

/** A witness may be one complete exact correction statement within a compound
 * turn. Require both full-source and statement-level proof; a cropped number,
 * omitted negation, narrated statement or arbitrary quote is not sufficient.
 * This inspects a detection view only and never changes the retained turn. */
export function exactCorrectionWitness(source:Turn,correction:Turn,original:string,evidence:string):boolean {
    if(contradictingCorrection([source,correction],source.id,original)?.id!==correction.id)return false;
    if(evidence===correction.content)return true;
    const start=correction.content.indexOf(evidence),end=start+evidence.length;
    if(!evidence.trim()||start<0||start!==correction.content.lastIndexOf(evidence))return false;
    const before=correction.content.slice(0,start),after=correction.content.slice(end);
    if(before.trim()&&!/[,:：.!;][ \t]*(?:(?:and|but)[ \t]+)?$/i.test(before))return false;
    if(after.trim()&&!/[.!;][ \t]*$/.test(evidence))return false;
    if(/^[ \t]*(?:if|unless|maybe|perhaps|pending|depending|temporarily)\b/i.test(after))return false;
    // A declarative fragment may rely on its original amendment prefix. Keep
    // that exact raw prefix for detection, rather than treating an arbitrary
    // standalone assertion as authority or inventing a new correction marker.
    const commandPrefix=before.trimEnd();
    const scoped=commandPrefix.endsWith(':')||commandPrefix.endsWith('：');
    const content=scoped&&isHandoffAmendmentCommand(commandPrefix.slice(0,-1))
        ?correction.content.slice(0,end):evidence;
    return contradictingCorrection([source,{...correction,content}],source.id,original)?.id===correction.id;
}
