export type DaniTranscriptRole = 'assistant' | 'user' | 'tool' | 'other';

export type DaniQaSeverity = 'critical' | 'warning';

export type DaniQaFindingCode =
    | 'transcript_unreadable'
    | 'unsupported_commercial_number'
    | 'unsupported_security_assurance'
    | 'provider_fallback_exposed'
    | 'missing_grounding_tool'
    | 'redundant_close_confirmation'
    | 'missing_end_session_tool'
    | 'end_call_confirmation_false'
    | 'verbose_reply'
    | 'consecutive_question_replies';

export type DaniTranscriptTurn = {
    index: number;
    role: DaniTranscriptRole;
    speaker: string;
    timestamp: string | null;
    content: string;
    sourceLine: number;
    wordCount: number;
    endsWithQuestion: boolean;
};

export type DaniTranscriptMetadata = {
    sessionId: string | null;
    persona: string | null;
    date: string | null;
};

export type DaniParsedTranscript = {
    metadata: DaniTranscriptMetadata;
    turns: DaniTranscriptTurn[];
};

export type DaniQaFinding = {
    code: DaniQaFindingCode;
    severity: DaniQaSeverity;
    deduction: number;
    message: string;
    turnIndex: number | null;
    timestamp: string | null;
    excerpt: string | null;
};

export type DaniLiveQaMetrics = {
    totalTurns: number;
    assistantTurns: number;
    userTurns: number;
    toolTurns: number;
    knowledgeToolCalls: number;
    endCallToolCalls: number;
    assistantWords: number;
    averageAssistantWords: number;
    medianAssistantWords: number;
    p90AssistantWords: number;
    maximumAssistantWords: number;
    repliesOverFortyWords: number;
    questionEndingReplies: number;
    consecutiveQuestionPairs: number;
};

export type DaniLiveQaReport = {
    schemaVersion: 1;
    status: 'pass' | 'fail';
    score: number;
    criticalCount: number;
    warningCount: number;
    metadata: DaniTranscriptMetadata;
    metrics: DaniLiveQaMetrics;
    findings: DaniQaFinding[];
};

type MutableTurn = {
    speaker: string;
    timestamp: string | null;
    lines: string[];
    sourceLine: number;
};

type DetectedPattern = {
    matched: boolean;
    examples: string[];
};

const TIMESTAMPED_HEADER = /^\[([^\]]{1,80})\]\s+([^:]{1,120}):\s*(.*)$/;
const PLAIN_HEADER = /^(Dani\b[^:]{0,100}|User|Visitor|Assistant|System|Tool(?:\s*\([^)]*\))?):\s*(.*)$/i;
const SPEAKING_TIME_LINE = /^\(Speaking time:\s*[0-9.]+s\)\s*$/i;
const WORD_PATTERN = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;
const QUESTION_END = /[?？](?:["'’”)}\]]*)$/u;

const COMMERCIAL_PATTERNS = [
    /\b\d+(?:\.\d+)?\s*(?:%|percent\b)/gi,
    /\b\d+\s*(?:-|–|—|to)\s*\d+\s*(?:business\s+)?(?:days?|weeks?|months?|years?)\b/gi,
    /\b(?:about|around|roughly|typically|usually|within|in|takes?|take|built in|live in|ready in)\s+\d+(?:\s*(?:-|–|—|to)\s*\d+)?\s*(?:business\s+)?(?:days?|weeks?|months?|years?)\b/gi,
    /(?:[$€£]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s*(?:USD|dollars?|euros?|pounds?)\b)/gi,
    /\b(?:low|mid|high)[ -]?(?:four|five|six|seven)[ -]?figures?\b/gi,
    /\b\d[\d,]*(?:\.\d+)?\s*(?:users?|calls?|sessions?|customers?|prospects?|inquiries)\s*(?:per|a)\s*(?:day|week|month)\b/gi,
] as const;

const SECURITY_ASSURANCE_PATTERNS = [
    /\bdata\s+(?:stays?|remains?)\s+(?:inside|in|within)\b/i,
    /\byour\s+data\s+never\s+leaves\b/i,
    /\b(?:never|does not|doesn't|won't|will not)\s+(?:store|retain|share|leave|send|expose)\b/i,
    /\b(?:we|it|the (?:assistant|agent|system|platform))\s+(?:only\s+)?(?:stores?|retains?|deletes?|encrypts?|hosts?|reads?)\b/i,
    /\b(?:hosted|runs?)\s+(?:in|on|within)\s+(?:your|our|a private|an internal)\b/i,
    /\bend[- ]to[- ]end\s+encrypt/i,
    /\b(?:SOC\s*2|HIPAA|GDPR|PCI(?:\s+DSS)?)\s+(?:compliant|certified|ready)\b/i,
    /\bzero[- ]data[- ]retention\b/i,
    /\braw\s+(?:customer|user)?\s*(?:text|data)\s+(?:is\s+)?(?:never|not)\s+(?:stored|retained)\b/i,
    /\bonly\s+reads?\s+(?:the\s+)?fields?\s+you\s+expose\b/i,
    /\b(?:deleted|purged)\s+after\b/i,
] as const;

const FALLBACK_PATTERNS = [
    /\b(?:sorry[, ]+)?i(?:'m| am)\s+(?:having trouble|unable to|struggling to)\s+(?:think|thinking|respond|answer)(?:ing)?\b/i,
    /\bsomething\s+went\s+wrong\b/i,
    /\bi(?:'m| am)\s+having\s+(?:a\s+)?technical\s+(?:issue|problem)\b/i,
    /\bi\s+can(?:not|'t)\s+process\s+that\s+right\s+now\b/i,
] as const;

const EXPLICIT_CLOSE_PATTERN = /\b(?:(?:let'?s|we can|we should)\s+wrap\s+(?:it\s+)?up|(?:end|close|stop)\s+(?:the\s+|this\s+|our\s+)?(?:call|conversation|session)|i(?:'m| am)\s+done|that(?:'s| is)\s+all|goodbye|take\s+care)\b/i;
const CLOSE_CONFIRMATION_PATTERN = /\b(?:would\s+you\s+like\s+me|do\s+you\s+want\s+me|should\s+i|shall\s+i|can\s+i)\s+(?:to\s+)?(?:end|close|wrap)\b/i;
const CLOSE_TOOL_PATTERN = /\bend_(?:call|dani_session)\b/i;
const HIGH_RISK_GROUNDING_PATTERN = /\b(?:AI Fusion Labs|X Agents?|price|pricing|cost|budget|timeline|delivery|deliver|security|privacy|hosting|retention|retain(?:ed|s|ing)?|stored?|storage|data handling|encrypt|compliance|SOC\s*2|HIPAA|GDPR|architecture|integrat(?:e|ion)|CRM|capabilit(?:y|ies)|pilot|proof|case stud(?:y|ies)|customer result|ROI|percentage|percent|benchmark|availability)\b/i;
const DETAIL_REQUEST_PATTERN = /\b(?:go\s+deeper|more\s+detail|in\s+detail|walk\s+me\s+through|break\s+(?:it|that)\s+down|give\s+me\s+(?:a\s+)?(?:list|breakdown)|explain\s+fully|comprehensive)\b/i;
const BOUNDARY_PATTERN = /\b(?:i\s+)?(?:(?:can(?:not|'t)|do\s+not|don't|won't|will\s+not|am\s+unable\s+to)\s+(?:confirm|promise|quote|approve|verify|commit|guarantee|provide|say)|not\s+approved|unverified|unknown|requires?\s+(?:human\s+)?confirmation|would\s+need\s+to\s+be\s+(?:confirmed|scoped|verified)|must\s+be\s+(?:confirmed|scoped|verified)|could\s+be\s+configured|may\s+be\s+possible|one\s+possible\s+design)\b/i;

const DEDUCTIONS: Record<DaniQaFindingCode, number> = {
    transcript_unreadable: 100,
    unsupported_commercial_number: 25,
    unsupported_security_assurance: 35,
    provider_fallback_exposed: 25,
    missing_grounding_tool: 25,
    redundant_close_confirmation: 20,
    missing_end_session_tool: 20,
    end_call_confirmation_false: 20,
    verbose_reply: 5,
    consecutive_question_replies: 4,
};

function normalizeTranscript(value: string): string {
    return String(value ?? '')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n?/g, '\n');
}

function roleOf(speaker: string): DaniTranscriptRole {
    const normalized = speaker.trim();
    if (/^tool\b/i.test(normalized)) return 'tool';
    if (/\bdani\b/i.test(normalized) || /^assistant$/i.test(normalized)) return 'assistant';
    if (/^(?:user|visitor)$/i.test(normalized)) return 'user';
    return 'other';
}

function wordCount(value: string): number {
    return value.match(WORD_PATTERN)?.length ?? 0;
}

function endsWithQuestion(value: string): boolean {
    return QUESTION_END.test(value.trim());
}

function cleanTurnContent(lines: string[]): string {
    return lines
        .filter(line => !SPEAKING_TIME_LINE.test(line.trim()))
        .join('\n')
        .trim()
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n');
}

function readMetadata(text: string): DaniTranscriptMetadata {
    const field = (label: string): string | null => {
        const match = text.match(new RegExp(`^${label}:\\s*(.+?)\\s*$`, 'im'));
        return match?.[1]?.trim() || null;
    };
    return {
        sessionId: field('Session ID'),
        persona: field('Persona'),
        date: field('Date'),
    };
}

function safeExcerpt(value: string, maximum = 180): string {
    const redacted = value
        .replace(/https?:\/\/\S+/gi, '[url]')
        .replace(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[email]')
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[id]')
        .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, '[phone]')
        .replace(/\s+/g, ' ')
        .trim();
    return redacted.length <= maximum ? redacted : `${redacted.slice(0, maximum - 1).trimEnd()}…`;
}

function splitClauses(value: string): string[] {
    return value
        .split(/(?:[.;!?]\s+|,\s+(?:but|however)\s+|\bhowever,\s*)/i)
        .map(item => item.trim())
        .filter(Boolean);
}

function detectUnsupportedCommercialNumbers(value: string): DetectedPattern {
    const examples = new Set<string>();
    for (const clause of splitClauses(value)) {
        if (BOUNDARY_PATTERN.test(clause)) continue;
        for (const pattern of COMMERCIAL_PATTERNS) {
            pattern.lastIndex = 0;
            for (const match of clause.matchAll(pattern)) examples.add(match[0]);
        }
    }
    return { matched: examples.size > 0, examples: [...examples].slice(0, 4) };
}

function detectUnsupportedSecurityAssurance(value: string): DetectedPattern {
    const examples = new Set<string>();
    for (const clause of splitClauses(value)) {
        if (BOUNDARY_PATTERN.test(clause)) continue;
        for (const pattern of SECURITY_ASSURANCE_PATTERNS) {
            const match = clause.match(pattern);
            if (match?.[0]) examples.add(match[0]);
        }
    }
    return { matched: examples.size > 0, examples: [...examples].slice(0, 4) };
}

function percentile(values: number[], fraction: number): number {
    if (!values.length) return 0;
    const ordered = [...values].sort((left, right) => left - right);
    const index = Math.max(0, Math.ceil(ordered.length * fraction) - 1);
    return ordered[index] ?? 0;
}

function finding(
    code: DaniQaFindingCode,
    severity: DaniQaSeverity,
    message: string,
    turn: DaniTranscriptTurn | null = null,
): DaniQaFinding {
    return {
        code,
        severity,
        deduction: DEDUCTIONS[code],
        message,
        turnIndex: turn?.index ?? null,
        timestamp: turn?.timestamp ?? null,
        excerpt: turn ? safeExcerpt(turn.content) : null,
    };
}

export function parseDaniTranscript(input: string): DaniParsedTranscript {
    const text = normalizeTranscript(input);
    const lines = text.split('\n');
    const mutable: MutableTurn[] = [];
    let current: MutableTurn | null = null;

    const flush = () => {
        if (current) mutable.push(current);
        current = null;
    };

    for (let offset = 0; offset < lines.length; offset += 1) {
        const line = lines[offset] ?? '';
        const timestamped = line.match(TIMESTAMPED_HEADER);
        const plain = timestamped ? null : line.match(PLAIN_HEADER);
        if (timestamped || plain) {
            flush();
            current = {
                timestamp: timestamped?.[1]?.trim() || null,
                speaker: (timestamped?.[2] ?? plain?.[1] ?? '').trim(),
                lines: [(timestamped?.[3] ?? plain?.[2] ?? '').trim()].filter(Boolean),
                sourceLine: offset + 1,
            };
            continue;
        }
        if (current) current.lines.push(line);
    }
    flush();

    const turns = mutable.map((item, index): DaniTranscriptTurn => {
        const content = cleanTurnContent(item.lines);
        return {
            index,
            role: roleOf(item.speaker),
            speaker: item.speaker,
            timestamp: item.timestamp,
            content,
            sourceLine: item.sourceLine,
            wordCount: wordCount(content),
            endsWithQuestion: endsWithQuestion(content),
        };
    }).filter(turn => turn.content.length > 0 || turn.role === 'tool');

    return {
        metadata: readMetadata(text),
        turns: turns.map((turn, index) => ({ ...turn, index })),
    };
}

export function evaluateDaniTranscript(input: string): DaniLiveQaReport {
    const parsed = parseDaniTranscript(input);
    const findings: DaniQaFinding[] = [];
    const assistantTurns = parsed.turns.filter(turn => turn.role === 'assistant' && turn.content.trim());
    const userTurns = parsed.turns.filter(turn => turn.role === 'user' && turn.content.trim());
    const toolTurns = parsed.turns.filter(turn => turn.role === 'tool');

    if (!assistantTurns.length || !userTurns.length) {
        findings.push(finding(
            'transcript_unreadable',
            'critical',
            'No complete Dani/user exchange could be parsed from this transcript.',
        ));
    }

    for (const turn of assistantTurns) {
        const previousUser = [...parsed.turns]
            .slice(0, turn.index)
            .reverse()
            .find(candidate => candidate.role === 'user');
        const groundingToolObserved = previousUser
            ? parsed.turns.some(candidate => (
                candidate.index > previousUser.index
                && candidate.index < turn.index
                && candidate.role === 'tool'
                && /\bknowledge[_\s-]*dani(?:[_\s-]|\b)/i.test(candidate.speaker)
            ))
            : false;
        if (
            previousUser
            && HIGH_RISK_GROUNDING_PATTERN.test(previousUser.content)
            && !groundingToolObserved
        ) {
            findings.push(finding(
                'missing_grounding_tool',
                'critical',
                'No Dani knowledge retrieval was observed before a high-risk company, commercial, architecture, security, or privacy answer.',
                turn,
            ));
        }

        const commercial = detectUnsupportedCommercialNumbers(turn.content);
        if (commercial.matched) {
            findings.push(finding(
                'unsupported_commercial_number',
                'critical',
                `Unsupported commercial target or estimate detected (${commercial.examples.join(', ')}).`,
                turn,
            ));
        }

        const security = detectUnsupportedSecurityAssurance(turn.content);
        if (security.matched) {
            findings.push(finding(
                'unsupported_security_assurance',
                'critical',
                `Unverified security, hosting, storage, or retention assurance detected (${security.examples.join(', ')}).`,
                turn,
            ));
        }

        if (FALLBACK_PATTERNS.some(pattern => pattern.test(turn.content))) {
            findings.push(finding(
                'provider_fallback_exposed',
                'critical',
                'A provider or orchestration fallback phrase was exposed as Dani dialogue.',
                turn,
            ));
        }

        const detailRequested = previousUser ? DETAIL_REQUEST_PATTERN.test(previousUser.content) : false;
        const wordLimit = detailRequested ? 90 : 40;
        if (turn.wordCount > wordLimit) {
            findings.push(finding(
                'verbose_reply',
                'warning',
                `Dani used ${turn.wordCount} words; this turn's offline limit is ${wordLimit}.`,
                turn,
            ));
        }
    }

    for (let index = 1; index < assistantTurns.length; index += 1) {
        const previous = assistantTurns[index - 1];
        const current = assistantTurns[index];
        if (previous?.endsWithQuestion && current?.endsWithQuestion) {
            findings.push(finding(
                'consecutive_question_replies',
                'warning',
                `Dani ended consecutive replies with questions (turns ${previous.index + 1} and ${current.index + 1}).`,
                current,
            ));
        }
    }

    for (const userTurn of userTurns) {
        if (!EXPLICIT_CLOSE_PATTERN.test(userTurn.content)) continue;
        const following = parsed.turns.filter(turn => turn.index > userTurn.index);
        const firstAssistant = following.find(turn => turn.role === 'assistant' && turn.content.trim());
        const firstEndCall = following.find(turn => turn.role === 'tool' && CLOSE_TOOL_PATTERN.test(turn.speaker));
        if (firstAssistant && CLOSE_CONFIRMATION_PATTERN.test(firstAssistant.content)) {
            findings.push(finding(
                'redundant_close_confirmation',
                'critical',
                'Dani asked for end-call confirmation after the visitor had already given explicit closing intent.',
                firstAssistant,
            ));
        }
        if (firstEndCall && /"?confirmed"?\s*:\s*false/i.test(firstEndCall.content)) {
            findings.push(finding(
                'end_call_confirmation_false',
                'critical',
                'The end_call tool was invoked with confirmed=false after explicit closing intent.',
                firstEndCall,
            ));
        }
        if (!firstEndCall) {
            findings.push(finding(
                'missing_end_session_tool',
                'critical',
                'No end_dani_session tool call was observed after explicit one-to-one closing intent.',
                userTurn,
            ));
        }
    }

    const wordCounts = assistantTurns.map(turn => turn.wordCount);
    const questionEndingReplies = assistantTurns.filter(turn => turn.endsWithQuestion).length;
    const metrics: DaniLiveQaMetrics = {
        totalTurns: parsed.turns.length,
        assistantTurns: assistantTurns.length,
        userTurns: userTurns.length,
        toolTurns: toolTurns.length,
        knowledgeToolCalls: toolTurns.filter(turn => /\bknowledge[_\s-]*dani(?:[_\s-]|\b)/i.test(turn.speaker)).length,
        endCallToolCalls: toolTurns.filter(turn => CLOSE_TOOL_PATTERN.test(turn.speaker)).length,
        assistantWords: wordCounts.reduce((sum, count) => sum + count, 0),
        averageAssistantWords: wordCounts.length
            ? Math.round((wordCounts.reduce((sum, count) => sum + count, 0) / wordCounts.length) * 10) / 10
            : 0,
        medianAssistantWords: percentile(wordCounts, 0.5),
        p90AssistantWords: percentile(wordCounts, 0.9),
        maximumAssistantWords: wordCounts.length ? Math.max(...wordCounts) : 0,
        repliesOverFortyWords: assistantTurns.filter(turn => turn.wordCount > 40).length,
        questionEndingReplies,
        consecutiveQuestionPairs: findings.filter(item => item.code === 'consecutive_question_replies').length,
    };

    const criticalCount = findings.filter(item => item.severity === 'critical').length;
    const warningCount = findings.filter(item => item.severity === 'warning').length;
    const deduction = findings.reduce((sum, item) => sum + item.deduction, 0);
    return {
        schemaVersion: 1,
        status: criticalCount > 0 ? 'fail' : 'pass',
        score: Math.max(0, 100 - deduction),
        criticalCount,
        warningCount,
        metadata: parsed.metadata,
        metrics,
        findings,
    };
}

export function formatDaniLiveQaReport(report: DaniLiveQaReport, label = 'transcript'): string {
    const session = report.metadata.sessionId ? ` | Session ${report.metadata.sessionId}` : '';
    const lines = [
        `Dani live QA: ${report.status.toUpperCase()} | Score ${report.score}/100${session}`,
        `Source: ${label}`,
        `Turns: ${report.metrics.assistantTurns} Dani, ${report.metrics.userTurns} visitor, ${report.metrics.toolTurns} tool`,
        `Voice: avg ${report.metrics.averageAssistantWords} words, median ${report.metrics.medianAssistantWords}, p90 ${report.metrics.p90AssistantWords}, max ${report.metrics.maximumAssistantWords}, over-40 ${report.metrics.repliesOverFortyWords}`,
        `Cadence: ${report.metrics.questionEndingReplies} question-ending replies, ${report.metrics.consecutiveQuestionPairs} consecutive pair(s)`,
        `Tools observed: ${report.metrics.knowledgeToolCalls} knowledge, ${report.metrics.endCallToolCalls} end-session`,
        `Findings: ${report.criticalCount} critical, ${report.warningCount} warning`,
    ];

    for (const item of report.findings) {
        const where = item.timestamp
            ? ` @ ${item.timestamp}`
            : item.turnIndex === null ? '' : ` @ turn ${item.turnIndex + 1}`;
        lines.push(`- ${item.severity.toUpperCase()} ${item.code}${where}: ${item.message}`);
        if (item.excerpt) lines.push(`  ${JSON.stringify(item.excerpt)}`);
    }

    lines.push(report.status === 'fail'
        ? 'Gate: FAILED. Do not spend Anam minutes until every critical finding is cleared.'
        : 'Gate: PASSED. Warnings remain advisory and should be reviewed before a paid live test.');
    return lines.join('\n');
}
