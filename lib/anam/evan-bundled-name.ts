/** A caller can introduce themselves while volunteering contact details, even
 * when Evan offered a recap rather than explicitly asking for their name. */
export function extractEvanBundledName(value: string, hasContactValue: boolean): string {
    if (!hasContactValue) return '';
    const text = value.normalize('NFKC').replace(/[’]/g, "'").trim()
        .replace(/^(?:(?:sure|yes|yeah|okay|ok|uh|um)[,.!\s]+)+/i, '');
    const introduction = text.match(/^(?:i'm|i am|this is)\s+/i);
    if (!introduction) return '';
    // Require a self-introduction, a full capitalized name, and an adjacent
    // first-person contact field. Never infer identity from an agent's readback,
    // quoted examples, a third party, or descriptions such as "I'm All Set."
    const name = text.slice(introduction[0].length).match(/^([\p{Lu}][\p{L}'’.-]*(?:\s+[\p{Lu}][\p{L}'’.-]*){1,3})(?:[,.;!]\s*|\s+and\s+)(?:[Aa]nd\s+)?[Mm]y\s+(?:phone|mobile|cell|callback|number|email|e-mail)\b/u)?.[1];
    return name && !/\b(?:moving|calling|looking|planning|going|trying|worried|concerned|confused|not|all|set|sure|ready|from|with|phone|email)\b/i.test(name)
        ? name : '';
}
