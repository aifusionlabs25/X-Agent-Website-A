/** Detection only: this module never rewrites a finalized visitor turn.
 * Direct final ending clauses can follow substantive facts. Quoted, reported,
 * conditional and negated endings are not conversational exit authority.
 * After closing begins, only the narrower courtesy grammar is accepted.
 */
type Clause={words:string[];exit:boolean;vocative:boolean};
const clauses:Clause[]=[];
function add(texts:string[],exit:boolean,vocative=false) {
    for(const text of texts)clauses.push({words:text.split(' '),exit,vocative});
}
add(['goodbye','bye','bye-bye'],true,true);
add(["that's all","that is all","that's all for now","that is all for now",
    "i'm all set","i am all set","i'm all set for now","i am all set for now",
    "we're done","we are done","we're finished","we are finished",
    "i'm done","i am done","that's everything","that is everything"],true);
add(['take care','good night'],true);
for(const adjective of ['good','great','nice'])for(const time of ['day','evening','night'])
    add(['have a '+adjective+' '+time],true);
add(['okay','ok','all right','alright',"you're welcome",'you are welcome'],false);
add(['thanks','thank you','thanks for your help','thank you for your help',
    'thanks for the help','thank you for the help','thanks for your time','thank you for your time'],false,true);
// A vocative is one name-like token after a comma, never a free-form clause.
// Clause starters and grammatical control words cannot be consumed as names.
const nonNames=new Set([...clauses.map(c=>c.words[0]),'and','or','but','if','because',
    'no','not','never',"don't",'do','does',"doesn't",'did',"didn't",'stop',
    'my','your','our','his','her','their','this','these','those','the','a','an',
    'he','she','they','it','you','me','us','to','for','from','with','about']);

function parse(text:string):{exit:boolean}|null {
    if(typeof text!=='string'||text.length>512)return null;
    const value=text.trim().toLowerCase().replaceAll('’',"'");
    // Question marks and quotation marks are deliberately not stripped.
    // Apostrophes/hyphens are valid only within word tokens (contractions/names).
    if(!value||/[^a-z'.,!;\s-]/.test(value))return null;
    const tokens=value.match(/[a-z]+(?:['-][a-z]+)*|[.,!;]/g)||[];
    if(tokens.length>96||tokens.join('')!==value.replace(/\s/g,''))return null;
    const separator=(token:string)=>/^[.,!;]$/.test(token);
    const memo=new Map<string,{exit:boolean}|null>();
    function walk(at:number,count:number):{exit:boolean}|null {
        while(at<tokens.length&&separator(tokens[at]))at++;
        if(at===tokens.length)return count?{exit:false}:null;
        if(count>=16)return null;
        if(count&&tokens[at]==='and')at++;
        const key=at+':'+count;
        if(memo.has(key))return memo.get(key)!;
        for(const clause of clauses) {
            if(!clause.words.every((word,i)=>tokens[at+i]===word))continue;
            const end=at+clause.words.length,positions=[end];
            // Completion modifiers belong to the direct first-person ending,
            // not to an arbitrary task ("done with the spreadsheet").
            if(clause.exit&&/^(?:i|we|that)/.test(clause.words[0])) {
                if(['now','today','here'].includes(tokens[end]))positions.push(end+1);
                if(tokens[end]==='for'&&['now','today'].includes(tokens[end+1]))positions.push(end+2);
                if(clause.words.at(-1)==='all'&&['i','we'].includes(tokens[end])
                    &&['need','needed','want','wanted'].includes(tokens[end+1])) {
                    positions.push(end+2);
                    if(tokens[end+2]==='for'&&['now','today'].includes(tokens[end+3]))positions.push(end+4);
                }
            }
            if(clause.vocative&&tokens[end]===','&&/^[a-z]+(?:['-][a-z]+)*$/.test(tokens[end+1]||'')
                &&!nonNames.has(tokens[end+1]))positions.push(end+2);
            for(const next of positions) {
                const rest=walk(next,count+1);
                if(rest) {const result={exit:clause.exit||rest.exit};memo.set(key,result);return result;}
            }
        }
        memo.set(key,null);return null;
    }
    return walk(0,0);
}

/** Mask quotations only for detecting boundaries; original evidence is retained
 * by appendTurn. Apostrophes within contractions/names are not quotations. */
function unquoted(text:string):string|null {
    let quote:string|null=null,masked='';
    for(let at=0;at<text.length;at++) {
        const char=text[at],apostrophe=char==="'"&&/[a-z]/i.test(text[at-1]||'')&&/[a-z]/i.test(text[at+1]||'');
        if(quote) {
            if(char===quote)quote=null;
            masked+=' ';
        } else if(!apostrophe&&['"',"'",'“','‘'].includes(char)) {
            quote=char==='“'?'”':char==='‘'?'’':char;masked+=' ';
        } else if(['”','’'].includes(char))return null;
        else masked+=char;
    }
    return quote?null:masked;
}

function scopedAgainstExit(prefix:string,continuesClause:boolean):boolean {
    const clauses=prefix.split(/[.!?;\n]/).map(value=>value.trim()).filter(Boolean);
    const last=clauses.at(-1)||'';
    // A final phrase governed by a report, instruction or condition is data,
    // even when punctuation separates it from the governing words.
    if(/\b(?:said|says|say|wrote|writes|reads|read|means|called|named|subject|quote|word|phrase|don't|do not|never|not)\s*[:,]?\s*$/.test(last))return true;
    if(/\b(?:said|says|wrote|writes|reads|read|quote|subject(?: is)?|message(?: is| was)?)\s*[:,]/.test(prefix))return true;
    const conditional=/\b(?:if|unless|whether|suppose|imagine|when|before|after|once)\b/;
    // A condition about the business is a fact, not a veto on an independent
    // goodbye. Only same-clause conditions or hypothetical exit/speech acts
    // govern the ending ("when I finish, goodbye", "if I say goodbye...").
    const exitOrSpeech=/\b(?:goodbye|bye|farewell|say|saying|said|repeat|quote)\b|\b(?:end|ends|ending|finish|finished|finishing|leave|leaving|close|closing)\b(?:\s+(?:the|this|our|my|your|a))?\s*(?:call|conversation|session|chat)?\s*$/;
    if(continuesClause&&conditional.test(last))return true;
    if(clauses.some(value=>conditional.test(value)&&exitOrSpeech.test(value)))return true;
    if(clauses.some(value=>/^(?:please\s+)?(?:say|repeat|write|type|quote|tell me how to say)\b/.test(value)
        ||/^(?:for|in) (?:an? )?example\b/.test(value)))return true;
    // Keep an explicit request not to finish authoritative across clauses.
    return /\b(?:don't|do not|never|not|isn't|wasn't|aren't|am not|no)\b[^.!?;\n]{0,60}\b(?:goodbye|bye|clos(?:e|ing)|end(?:ing)?|finish(?:ing)?|done|leav(?:e|ing))\b/.test(prefix)
        ||/\b(?:keep (?:this|the) (?:call|conversation|session) (?:open|going)|stay (?:here|on the line)|not yet)\b/.test(prefix);
}

/** Starts closure only when a direct terminal clause is present. Thanks/okay
 * alone remain ordinary conversation and cannot begin closing. */
export function clearExit(text:string):boolean {
    if(typeof text!=='string'||text.length>512)return false;
    if(parse(text)?.exit===true)return true;
    const value=text.trim().toLowerCase().replace(/([a-z])’(?=[a-z])/g,"$1'");
    const plain=unquoted(value);
    if(!plain||/[<>]/.test(plain))return false;
    // Only an independent final clause can close after meaningful facts. This
    // does not discard those facts or treat a standalone acknowledgment as exit.
    for(const boundary of plain.matchAll(/[.!?;,\n]\s*/g)) {
        const at=boundary.index!+boundary[0].length;
        const prefix=plain.slice(0,boundary.index),ending=value.slice(at).replace(/^(?:and|so)\s+/,'');
        // A comma alone does not establish a new speaker act after arbitrary
        // prose; require coordination or a known courtesy before it.
        if(boundary[0].startsWith(',')&&!/^(?:and|so)\s+/.test(value.slice(at))&&parse(prefix)===null)continue;
        if(prefix.trim()&&!scopedAgainstExit(prefix,boundary[0].startsWith(','))&&parse(ending)?.exit===true)return true;
    }
    return false;
}

/** Accept only trailing courtesy/end fragments after closure has ALREADY
 * begun. This is not permission to accept new facts or initiate closure. */
export function closingCourtesy(text:string):boolean {return parse(text)!==null;}
