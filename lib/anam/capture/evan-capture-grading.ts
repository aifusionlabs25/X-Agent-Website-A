import type { EvanCaptureFact } from './evan-capture.ts';

const fold = (value: string) => value.normalize('NFKC').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

/** Grading only, after source validation. Recognize a complete literal item/care
 * label split into two linked facts. Never manufacture a fact or cross-bind an
 * adjective to another item, location, ambiguous group, or evidence span. */
export function matchingEvanItemCare(expected: string, item: EvanCaptureFact, facts: EvanCaptureFact[]): EvanCaptureFact | undefined {
    if (item.category !== 'inventory' || item.status !== 'asserted') return;
    const siblings = facts.filter(fact => fact.category === 'inventory' && fact.status === 'asserted'
        && fact.location === item.location && fold(fact.value) === fold(item.value));
    if (siblings.length !== 1) return;
    return facts.find(care => care.category === 'care' && care.status === 'asserted'
        && care.location === item.location && fold(care.scope) === fold(item.value)
        && [fold(`${care.value} ${item.value}`), fold(`${item.value} ${care.value}`)].includes(fold(expected))
        && care.evidence.some(cited => item.evidence.some(original => cited.turn === original.turn
            && fold(cited.quote) === fold(original.quote) && fold(cited.quote).includes(fold(expected)))));
}
