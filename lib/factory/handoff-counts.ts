/** Canonical count values for detection only. Original text and offsets stay raw.
 * This is an integer grammar, not a fact/intent classifier. Unsupported numbers
 * and ambiguous scope still require the caller's existing fail-closed checks.
 */
const units='one|two|three|four|five|six|seven|eight|nine';
const small='zero|'+units+'|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen';
const tens='twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
const underHundred=`(?:(?:${tens})(?:[ -]+(?:${units}))?|(?:${small}))`;
const cardinal=`(?:(?:${units})[ \t]+hundred(?:[ \t]+(?:and[ \t]+)?${underHundred})?|${underHundred})`;
export const countPattern=`(?:\\d+|${cardinal})`;
const values:Record<string,number>={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,
    ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,
    twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
export function countValue(raw:string):string|null {
    if(/^\d+$/.test(raw))return BigInt(raw).toString();
    if(!new RegExp(`^(?:${cardinal})$`,'i').test(raw))return null;
    let value=0;
    for(const word of raw.toLowerCase().split(/[ \t-]+/)) {
        if(word==='and')continue;
        if(word==='hundred'){value*=100;continue;}
        value+=values[word];
    }
    return String(value);
}
export function countTokens(raw:string):Array<{start:number;end:number;raw:string;value:string}> {
    const result:Array<{start:number;end:number;raw:string;value:string}>=[];
    for(const m of raw.matchAll(new RegExp(`(?<![\\w.])${countPattern}(?!\\w|\\.\\d)`,'gi'))) {
        const value=countValue(m[0]);
        if(value!==null)result.push({start:m.index!,end:m.index!+m[0].length,raw:m[0],value});
    }
    return result;
}
export function countView(raw:string):string {
    let view=raw;
    for(const token of countTokens(raw).reverse()) {
        // The existing "one correction" opener is discourse, not a second
        // replacement count in the statement that follows it.
        if(token.raw.toLowerCase()==='one'&&/^[ \t]+correction\b/i.test(raw.slice(token.end)))continue;
        view=view.slice(0,token.start)+token.value+view.slice(token.end);
    }
    return view;
}
