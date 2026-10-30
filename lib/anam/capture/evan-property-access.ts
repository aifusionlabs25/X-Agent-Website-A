import type { EvanCaptureFact } from './evan-capture.ts';

const fold = (x: string) => x.normalize('NFKC').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
const last = (f: EvanCaptureFact) => Math.max(...f.evidence.map(e => e.turn));

const ambiguous = /[?"“”]|\b(?:not|without|never|if|maybe|might|possibly|could|said|says|picture|photo)\b/iu;
const count = '(?:\\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?)';
const steps = new RegExp(`^(?:no|${count}) steps?$`, 'iu');
function dimension(text: string): string | null {
    if (steps.test(text)) return 'steps';
    if (/^(?:(?:no|an?)\s+)?elevators?$/iu.test(text)) return 'elevator';
    if (/^(?:no\s+)?stairs$/iu.test(text)) return 'stairs';
    if (/^(?:ground|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))[- ]floor(?: entrance)?$/iu.test(text)) return 'floor';
    return null;
}

/** A bounded display view, never new accepted facts. Every access component is
 * an exact span in the same literal property value, with the original endpoint,
 * scope and evidence. Mixed/ambiguous clauses stay intact for review. */
export function propertyAccessParts(f: EvanCaptureFact): {
    property: string; access: string[]; accessSpans: {start: number; end: number; text: string}[];
} | null {
    if (f.category !== 'property' || f.status !== 'asserted' || f.quantity || f.route !== null) return null;
    if (ambiguous.test(f.value)) return null;
    const match = f.value.match(/^(.+?)(?:,\s*|\s+with\s+)(.+?)[.!]?$/u);
    if (!match || /\bno\b/iu.test(match[1])) return null;
    if (!f.evidence.some(e => fold(e.quote).includes(fold(f.value)) && !ambiguous.test(e.quote))) return null;
    const access = match[2].split(/,\s*(?:and\s+)?|;\s*|\s+(?:and|with)\s+/iu).map(s => s.trim());
    const dimensions = access.map(dimension);
    if (!access.length || dimensions.includes(null) || new Set(dimensions).size !== dimensions.length) return null;
    let cursor = match[1].length;
    const accessSpans = access.map(text => {
        const start = f.value.indexOf(text, cursor), end = start + text.length;
        cursor = end;
        return {start, end, text};
    });
    return {property: match[1], access, accessSpans};
}

export function currentPropertyAccess(f: EvanCaptureFact, facts: EvanCaptureFact[]): string[] {
    const parts = propertyAccessParts(f);
    if (!parts) return [];
    // A later explicit access state (including an unknown or removal) takes
    // precedence. Same-turn conflicts are not silently resolved by array order.
    if (facts.some(other => other.category === 'access' && other.location === f.location
        && fold(other.scope) === fold(f.scope) && last(other) >= last(f))) return [];
    return parts.access;
}
