// Visitor-only, already-redacted input. Unknowns are qualification facts, not approvals.
export function isQualificationOpenItem(value: string): boolean {
    return /\b(?:funding|budget|approval|timeline|timing|data flows?|requirements?|compliance)\b/i.test(value)
        && /\b(?:undetermined|unknown|unclear|unconfirmed|unfunded|pending|not yet|not fully|not (?:confirmed|approved|funded)|no longer (?:approved|confirmed|funded)|haven't|hasn't|not reviewed|need to (?:confirm|clarify|validate|identify)|needs? (?:confirmation|clarification|validation))\b/i.test(value);
}

export function readAmyQualificationFacts(userTurns: string[]) {
    let infrastructureStatus = '';
    let funding = '';
    let fundingOpen = false;
    let dataReview = '';
    let timingPending = '';
    let aiFundingContext = false;
    const statements: string[] = [];
    for (const turn of userTurns) {
        const parts = turn.split(/(?<=[.!?])\s+/);
        const previousAiFundingContext = aiFundingContext;
        aiFundingContext = /\bAI\b/i.test(turn) && /\bfund(?:ing|ed)?\b|\bbudget\b/i.test(turn);
        for (const [index, raw] of parts.entries()) {
            const text = raw.trim().replace(/[.!?]+$/, '').slice(0, 240);
            statements.push(raw);
            if (/\binfrastructure (?:upgrade|refresh|modernization)\b/i.test(text)
                && /\b(?:funded|unfunded|scoped|approved|not funded)\b/i.test(text)
                && !/\?|\b(?:if|whether|would|could|might)\b/i.test(raw)) {
                infrastructureStatus = text;
                const next = parts[index + 1];
                if (next && /^it(?:'s| is) scoped\b/i.test(next.trim())) infrastructureStatus += `; ${next.trim().replace(/[.!?]+$/, '')}`;
            }
            if (/\b(?:funding|budget)\b/i.test(text)
                && (/\bAI\b/i.test(text) || (/^the funding source\b/i.test(text) && (aiFundingContext || previousAiFundingContext)))) {
                if (isQualificationOpenItem(text) || /\bneed to confirm\b/i.test(text)) {
                    funding = `Unconfirmed: ${text}`;
                    fundingOpen = true;
                } else if (/\b(?:approved|confirmed|funded|allocated)\b/i.test(text)
                    && !/\?|\b(?:not|no|if|whether|might|could|would|hasn't|haven't)\b/i.test(text)) {
                    funding = `Visitor-reported: ${text}`;
                    fundingOpen = false;
                }
            }
            if (/\bAI data flows?\b/i.test(text) && /\b(?:reviewed|validated|pending|review)\b/i.test(text)
                && !/\?|\b(?:if|whether|would|could|might)\b/i.test(raw)) dataReview = text;
            if (/\b(?:timeline|timing)\b/i.test(text)) timingPending = /\b(?:haven't|hasn't|not|undetermined|unknown|unaligned)\b/i.test(text) ? text : '';
        }
    }
    const categoryStatements = statements.filter(s => !/\?|\b(?:not|no|don't|doesn't|without|exclude|excluding|whether|if|might)\b/i.test(s));
    const text = categoryStatements.join(' ');
    return {
        infrastructureStatus, funding, fundingOpen, dataReview, timingPending,
        criminalJusticeData: /\b(?:our data includes|data contains|we (?:use|handle|process))\b.{0,60}\bcriminal justice information\b/i.test(text),
        statePrivacy: /\bstate[ -]level (?:data )?privacy (?:rules|requirements|laws)\b/i.test(text),
    };
}
