// Call only with canonical, contact-redacted visitor turns. Agent/tool prose is never evidence.
// These are reported discovery facts, not findings independently verified by Amy.
export function readAmySecurityFacts(userTurns: string[]) {
    let encryptionFinding = '';
    let accessFinding = '';
    let encryptionScope = '';
    let accessScope = '';
    let requirement = '';
    let accountableTeam = '';
    let ownershipStatus = '';
    let evidenceSource = '';
    let auditDeadline = '';
    let auditTimingPending = false;
    let nist = false;
    let encryptionMapping = '';
    let accessMapping = '';
    let priorEncryptionContext = false;
    const tidy = (value: string) => value.trim().replace(/[.!;,]+$/, '').slice(0, 220);
    const conjecture = (value: string) => /\?|\b(?:if|whether|hypothetically|suppose|might|could|would|possibly|perhaps|not sure)\b/i.test(value);
    const findingRetracted = (value: string, topic: 'encryption' | 'privileged[ -]access') =>
        new RegExp(`\\b(?:no|not any|don't have|do not have|doesn't have|does not have)\\s+(?:known\\s+)?${topic}\\b`, 'i').test(value)
        || new RegExp(`\\b${topic}\\b.{0,70}\\b(?:cleared|resolved|retracted|withdrawn|ruled out|not found|not identified|not an? (?:issue|gap)|no longer an? (?:issue|gap))\\b`, 'i').test(value);

    for (const rawTurn of userTurns) {
        const turn = rawTurn.replace(/[’‘]/g, "'");
        const turnHasEncryption = /\bencryption\b/i.test(turn);
        const turnHasOwner = /\b(?:CISO'?s?|security|IT|infrastructure)\s+team\b/i.test(turn);
        const turnHasAudit = /\baudit\b/i.test(turn);
        for (const raw of turn.split(/(?<=[.!?;])\s+|\s+(?:but|however)\s+(?=(?:we|our|the|it|they|that|this|I)\b)/i)) {
            const text = tidy(raw);
            if (!text || conjecture(raw)) continue;
            const encryption = /\bencryption\b/i.test(text);
            const access = /\bprivileged[ -]access\b/i.test(text);
            const positiveScope = text.split(/,?\s+not\s+(?:\d+|around|about|approximately)\b/i)[0];
            const retracted = /\b(?:no|not|don't have|do not have|doesn't have|does not have|no longer|cleared|resolved|retracted|withdrawn|ruled out)\b/i.test(positiveScope);

            if (/\b(?:gap assessment|gap analysis|audit report|security assessment)\b/i.test(text)) {
                evidenceSource = /\b(?:no|don't have|do not have|unavailable|retracted|withdrawn)\b/i.test(text)
                    ? ''
                    : /\b(?:have|completed|conducted|reviewed|shows?|identified|found|flagged)\b/i.test(text)
                    ? `Visitor-reported ${/\brecent\b/i.test(text) ? 'recent ' : ''}${text.match(/\b(?:gap assessment|gap analysis|audit report|security assessment)\b/i)![0].toLowerCase()}; source not independently reviewed`
                    : evidenceSource;
            }
            if (encryption && /\b(?:gaps?|findings?|issues?|outdated|obsolete|weak|legacy|unsupported)\b/i.test(text)) {
                const withdrawn = findingRetracted(text, 'encryption');
                if (withdrawn) { encryptionFinding = ''; encryptionScope = ''; encryptionMapping = ''; requirement = ''; }
                else if (!retracted) encryptionFinding = /\b(?:outdated|obsolete|weak|legacy|unsupported)\b/i.test(text) ? 'Outdated encryption reported' : encryptionFinding || 'Encryption control gap reported';
            }
            if (access && /\b(?:gaps?|findings?|issues?|weaknesses?)\b/i.test(text)) {
                const withdrawn = findingRetracted(text, 'privileged[ -]access');
                if (withdrawn) { accessFinding = ''; accessScope = ''; accessMapping = ''; }
                else if (!retracted) accessFinding = 'Privileged-access issues reported';
            }

            // A scoped count replaces an earlier count. Ignore the rejected half of a correction.
            if (encryption && /\b(?:affects?|covers?|scope|systems?|applications?)\b/i.test(text)) {
                if (retracted && positiveScope === text) encryptionScope = '';
                else {
                    const count = positiveScope.match(/\b(?:around|about|approximately|roughly|~)\s*(\d+)\b/i)?.[1]
                        ?? positiveScope.match(/\b(\d+)\s+(?:(?:external|internal|internet|public)[ -]facing\s+)?(?:systems?|applications?)\b/i)?.[1];
                    const facing = positiveScope.match(/\b(?:external|internal|internet|public)[ -]facing\b/i)?.[0].toLowerCase().replace(' ', '-');
                    if (count || facing) encryptionScope = `Encryption: ${count ? `${/\b(?:around|about|approximately|roughly)\b|~/i.test(positiveScope) ? 'approximately ' : ''}${count} ` : ''}${facing ? `${facing} ` : ''}systems (visitor-reported)`;
                }
            }
            if (access && /\b(?:admin(?:istrator)? accounts?|fewer systems|smaller scope|critical)\b/i.test(text)) {
                accessScope = retracted ? '' : `Privileged access: ${/\badmin(?:istrator)? accounts?\b/i.test(text) ? 'admin accounts' : 'affected systems'}${/\b(?:fewer systems|smaller scope)\b/i.test(text) ? '; smaller reported system scope' : ''}${/\bcritical\b/i.test(text) ? '; described as critical' : ''} (visitor-reported)`;
            }
            if (/\bNIST\b/i.test(text) && /\b(?:aligned|alignment|controls?|framework|required|requirement|follow|mapped|applies)\b/i.test(text)) nist = !retracted;
            if (encryption && /\b(?:ties? to|mapped to|maps? to|in the)\b/i.test(text) && /\bsystem(?:s)? and communications? protection\b|\bSC\b/i.test(text)) encryptionMapping = retracted ? '' : 'encryption → System and communications protection';
            if (access && /\b(?:ties? to|mapped to|maps? to|in)\b/i.test(text) && /\baccess control\b|\bAC\b/i.test(text)) accessMapping = retracted ? '' : 'privileged access → Access control';

            const tls = text.match(/\bTLS\s+(\d+\.\d+)(\s+minimum)?\b/i);
            if (tls && (encryptionFinding || turnHasEncryption || priorEncryptionContext)) {
                if (retracted && !/\b(?:instead|actually|correction)\b/i.test(text)) requirement = '';
                else if (/\b(?:it'?s|it is|is|requires?|required|minimum|confirmed|specified)\b/i.test(text)) {
                    requirement = `Visitor-reported TLS ${tls[1]}${tls[2] ? ' minimum' : ''}; applicability and implementation require specialist validation`;
                }
            }

            const team = text.match(/\b(?:CISO'?s?|(?:information |cyber)?security|IT|infrastructure)\s+team\b/i)?.[0];
            if (team && /\b(?:owns?|will own|accountable|responsible|lead(?:s|ing)?)\b/i.test(text)) {
                accountableTeam = retracted ? '' : `${team.replace(/CISO'?s?/i, 'CISO')} (visitor-reported accountable team)`;
            }
            if (/\b(?:owners?|leads?|assignments?)\b/i.test(text) && /\b(?:pending|not|unassigned|unconfirmed|haven't|hasn't|still|need to|to be|TBC)\b/i.test(text)
                || turnHasOwner && /\b(?:haven't|have not|not yet|not)\b.{0,35}\bfinali[sz]ed\b/i.test(text)) {
                ownershipStatus = 'Individual workstream leads not confirmed; clarify assignments with the accountable team';
            } else if (/\b(?:owners?|leads?)\b/i.test(text) && /\b(?:assigned|confirmed|named)\b/i.test(text) && !retracted && !/\blikely\b/i.test(text)) {
                ownershipStatus = 'Visitor reports individual workstream leads assigned; confirm roles and responsibilities at handoff';
            }
            if (/\baudit\b/i.test(text) || turnHasAudit && /\bdeadline\b/i.test(text)) {
                if (/\b(?:cancelled|canceled|no longer required|withdrawn)\b/i.test(text)) { auditDeadline = ''; auditTimingPending = true; }
                else if (/\b(?:due|deadline|within|required|in)\b/i.test(text)) {
                    const positiveDeadline = text.split(/\b(?:but|instead|now)\b/i).at(-1) ?? text;
                    const durations = [...positiveDeadline.matchAll(/\b(\d+|thirty|sixty|ninety)\s*[- ]\s*(days?|weeks?|months?)\b/gi)];
                    const duration = durations.at(-1);
                    if (duration && !/\b(?:not|no longer|uncertain|unconfirmed)\b/i.test(positiveDeadline)) {
                        auditDeadline = `Visitor-reported ${/\bstate[ -]mandated\b/i.test(text) ? 'state-mandated ' : ''}audit due in ${duration[1]} ${duration[2]}; not an approved remediation schedule`;
                        auditTimingPending = false;
                    } else if (/\b(?:not|no longer|uncertain|unconfirmed|unknown)\b/i.test(text)) { auditDeadline = ''; auditTimingPending = true; }
                }
            }
        }
        priorEncryptionContext = turnHasEncryption;
    }

    const findings = [encryptionFinding, accessFinding].filter(Boolean).join('; ');
    const affectedScope = [encryptionScope, accessScope].filter(Boolean).join('; ');
    const mappings = [encryptionMapping, accessMapping].filter(Boolean);
    return {
        findings, affectedScope, encryptionFinding, accessFinding, encryptionScope, accessScope,
        requirement, accountableTeam, ownershipStatus, evidenceSource, auditDeadline, auditTimingPending,
        governanceDrivers: [nist ? 'NIST alignment (visitor-reported)' : '', mappings.length ? `Reported mapping: ${mappings.join('; ')}; specialist validation required` : ''].filter(Boolean),
        hasTwoWorkstreams: Boolean(encryptionFinding && accessFinding),
    };
}
