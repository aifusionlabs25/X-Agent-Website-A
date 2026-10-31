/** Detection only: this module never rewrites a finalized visitor turn.
 * A whole utterance must consist of direct ending/courtesy clauses. Merely
 * mentioning, quoting, negating or discussing a goodbye is not exit intent.
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

/** Starts closure only when a direct terminal clause is present. Thanks/okay
 * alone remain ordinary conversation and cannot begin closing. */
export function clearExit(text:string):boolean {return parse(text)?.exit===true;}

/** Accept only trailing courtesy/end fragments after closure has ALREADY
 * begun. This is not permission to accept new facts or initiate closure. */
export function closingCourtesy(text:string):boolean {return parse(text)!==null;}
