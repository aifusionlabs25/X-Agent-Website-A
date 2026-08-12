export type AmyLiveQaFindingCode =
    | 'transcript_unreadable'
    | 'greeting_mismatch'
    | 'provider_fallback_exposed'
    | 'reasoning_markup_exposed'
    | 'assistant_interrupted'
    | 'verbose_reply'
    | 'unsupported_cjis_boundary'
    | 'invented_ai_pilot'
    | 'invented_technical_plan'
    | 'spoken_email_handling'
    | 'tool_markup_exposed'
    | 'case_study_visual_substitution'
    | 'duplicate_visual_confirmation'
    | 'unsupported_service_commitment'
    | 'premature_close_attempt'
    | 'missing_end_session_tool';

export type AmyLiveQaFinding = {
    code: AmyLiveQaFindingCode;
    severity: 'critical' | 'warning';
    deduction: number;
    turn: number | null;
    excerpt: string | null;
};

export type AmyLiveQaReport = {
    status: 'pass' | 'fail';
    score: number;
    findings: AmyLiveQaFinding[];
    metrics: {
        assistantTurns: number;
        userTurns: number;
        toolTurns: number;
        maximumAssistantWords: number;
        repliesOverSixtyWords: number;
    };
};

type Turn = { role: 'assistant' | 'user' | 'tool'; speaker: string; content: string; words: number };

export const AMY_CANONICAL_GREETING = "Hi, I'm Amy with Insight Enterprises. Who am I speaking with today?";

const HEADER = /^(?:\[([^\]]+)\]\s+)?(Amy(?:\s+Insight SDR[^:]*)?|User|Visitor|Tool(?:\s*\([^)]*\))?):\s*(.*)$/i;
const SPEAKING_TIME = /^\(Speaking time:/i;
const EXPLICIT_CLOSE = /\b(?:(?:let'?s|we can|we should)\s+(?:call it a day|wrap\s+(?:(?:it|this)\s+)?up)|(?:end|close|stop)\s+(?:the\s+|this\s+|our\s+)?(?:call|conversation|session)|i(?:'m| am)\s+done|goodbye|take\s+care|that(?:'s| is)\s+a\s+wrap(?:\s+on\s+(?:the\s+)?role[ -]?play)?|(?:the\s+)?role[ -]?play\s+(?:is\s+)?(?:over|finished|done))\b/i;
const SOFT_CLOSE = /\b(?:we(?:'re| are) all set|let'?s wrap(?: it| this)?(?: up)?|call it a day|thanks? for (?:your|the) time|i(?:'ve| have) got what i need|we(?:'ll| will) talk next steps)\b|^\s*that(?:'s| is) (?:it|all)[.!]?\s*$/i;
const SOFT_COMPLETION = /\b(?:that(?:'s| is) what i needed|i(?:'ll| will) take this forward|i(?:'ll| will) run with this)\b/i;
const TOOL_MARKUP = /<\s*end_(?:call|amy_session)\b|\bend_(?:call|amy_session)\s*\{/i;
const PENDING_REQUEST = /\bbefore\s+we\s+(?:wrap|finish|end)\b[\s\S]{0,180}\b(?:can|could|would|will|show|tell|explain|help|what|how|why)\b/i;
const CUSTOMER_EVIDENCE_REQUEST = /\b(?:case stud(?:y|ies)|customer (?:example|reference|story)|similar (?:customer|client|organization|public[- ]sector environment)|what Insight has done|proof point|prior outcome)\b/i;

function countWords(value: string): number {
    return value.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function excerpt(value: string): string {
    const clean = value.replace(/\s+/g, ' ').trim();
    return clean.length <= 180 ? clean : `${clean.slice(0, 179).trimEnd()}…`;
}

function parse(input: string): Turn[] {
    const turns: Turn[] = [];
    let current: { speaker: string; lines: string[] } | null = null;
    const flush = () => {
        if (!current) return;
        const content = current.lines.filter((line) => !SPEAKING_TIME.test(line.trim())).join('\n').trim();
        const role = /^tool/i.test(current.speaker) ? 'tool'
            : /^(?:user|visitor)$/i.test(current.speaker) ? 'user'
            : 'assistant';
        if (content || role === 'tool') turns.push({ role, speaker: current.speaker, content, words: countWords(content) });
        current = null;
    };
    for (const line of String(input ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')) {
        const match = line.match(HEADER);
        if (match) {
            flush();
            current = { speaker: match[2].trim(), lines: match[3] ? [match[3]] : [] };
        } else if (current) current.lines.push(line);
    }
    flush();
    return turns;
}

const DEDUCTIONS: Record<AmyLiveQaFindingCode, number> = {
    transcript_unreadable: 100,
    greeting_mismatch: 8,
    provider_fallback_exposed: 40,
    reasoning_markup_exposed: 40,
    assistant_interrupted: 35,
    verbose_reply: 8,
    unsupported_cjis_boundary: 30,
    invented_ai_pilot: 25,
    invented_technical_plan: 30,
    spoken_email_handling: 35,
    tool_markup_exposed: 35,
    case_study_visual_substitution: 30,
    duplicate_visual_confirmation: 8,
    unsupported_service_commitment: 25,
    premature_close_attempt: 30,
    missing_end_session_tool: 25,
};

export function evaluateAmyTranscript(input: string): AmyLiveQaReport {
    const turns = parse(input);
    const assistantTurns = turns.filter((turn) => turn.role === 'assistant');
    const userTurns = turns.filter((turn) => turn.role === 'user');
    const toolTurns = turns.filter((turn) => turn.role === 'tool');
    const findings: AmyLiveQaFinding[] = [];
    const add = (code: AmyLiveQaFindingCode, severity: 'critical' | 'warning', turn: number | null, value = '') => {
        findings.push({ code, severity, deduction: DEDUCTIONS[code], turn, excerpt: value ? excerpt(value) : null });
    };

    if (!assistantTurns.length || !userTurns.length) add('transcript_unreadable', 'critical', null);
    if (assistantTurns[0] && assistantTurns[0].content.trim() !== AMY_CANONICAL_GREETING) {
        add('greeting_mismatch', 'warning', turns.indexOf(assistantTurns[0]), assistantTurns[0].content);
    }

    for (const assistant of assistantTurns) {
        const index = turns.indexOf(assistant);
        const priorUser = [...turns.slice(0, index)].reverse().find((turn) => turn.role === 'user');
        if (assistant.words > 60) add('verbose_reply', assistant.words > 90 ? 'critical' : 'warning', index, assistant.content);
        if (/\(Message was interrupted\)/i.test(assistant.content)) {
            add('assistant_interrupted', 'critical', index, assistant.content);
        }
        if (/<\/?\s*think\b/i.test(assistant.content)) {
            add('reasoning_markup_exposed', 'critical', index, assistant.content);
        }
        if (/\b(?:sorry,?\s+)?i(?:'m| am)\s+(?:having trouble thinking|unable to think|not able to think)\b|\bsomething went wrong in my thinking\b/i.test(assistant.content)) {
            add('provider_fallback_exposed', 'critical', index, assistant.content);
        }
        if (/\b(?:state|say|repeat|spell|share).{0,50}\b(?:email|e-mail|address)\b|\b(?:I heard|I have|I got|I've got|recorded).{0,120}(?:@|\bat\s+(?:gmail|outlook|hotmail|yahoo)\b|\b(?:gmail|outlook|hotmail|yahoo)\s+(?:dot|\.)\s*com\b)/i.test(assistant.content)) {
            add('spoken_email_handling', 'critical', index, assistant.content);
        }
        if (TOOL_MARKUP.test(assistant.content)) {
            add('tool_markup_exposed', 'critical', index, assistant.content);
            if (priorUser && SOFT_COMPLETION.test(priorUser.content) && !EXPLICIT_CLOSE.test(priorUser.content)) {
                add('premature_close_attempt', 'critical', index, priorUser.content);
            }
        }
        if (/\bthe visual brief is now open\b[\s\S]{0,100}\bthe visual brief is now open\b/i.test(assistant.content)) {
            add('duplicate_visual_confirmation', 'warning', index, assistant.content);
        }
        if (/\bwe(?:'ll| will) work with you to\b|\b(?:an )?Insight specialist can\b.{0,100}\b(?:draft|deliver|create)\b.{0,80}\b(?:detailed|tailored|modernization)\b/i.test(assistant.content)) {
            add('unsupported_service_commitment', 'critical', index, assistant.content);
        }
        if (/\b(?:non[- ]CJIS|non[- ]sensitive)\b[\s\S]{0,180}\b(?:keep it out|outside)\b[\s\S]{0,80}\b(?:protected domain|CJIS)\b|\bstandard security controls rather than the full CJIS regime\b/i.test(assistant.content)) {
            add('unsupported_cjis_boundary', 'critical', index, assistant.content);
        }
        if (/\b(?:i(?:['’]d| would) run|start|schedule|launch)\b[\s\S]{0,60}\b(?:AI )?(?:pilot|proof[\p{Pd} ]of[\p{Pd} ]concept)\b/iu.test(assistant.content)
            && !/\b(?:cannot|can't|should not|shouldn't|before calling it|not approved|not scheduled)\b/i.test(assistant.content)) {
            add('invented_ai_pilot', 'critical', index, assistant.content);
        }
        if (/\b(?:10\s*%|host the model|on[- ]prem|private cloud|same quarter|certify the AI tool|integration or user[- ]experience impacts)\b/i.test(assistant.content)) {
            add('invented_technical_plan', 'critical', index, assistant.content);
        }
    }

    for (const user of userTurns) {
        const index = turns.indexOf(user);
        if (CUSTOMER_EVIDENCE_REQUEST.test(user.content)) {
            const nextUserIndex = turns.findIndex((turn, turnIndex) => turnIndex > index && turn.role === 'user');
            const beforeNextUser = turns.slice(index + 1, nextUserIndex < 0 ? turns.length : nextUserIndex);
            const visualOpened = beforeNextUser.some((turn) => turn.role === 'tool' && /show_visual_brief/i.test(turn.speaker));
            const illustrativeRequested = /\b(?:illustrative|hypothetical|working view|not a case study)\b/i.test(user.content);
            if (visualOpened && !illustrativeRequested) {
                add('case_study_visual_substitution', 'critical', index, user.content);
            }
        }
        if (PENDING_REQUEST.test(user.content) || (!EXPLICIT_CLOSE.test(user.content) && !SOFT_CLOSE.test(user.content))) continue;
        if (!turns.slice(index + 1).some((turn) => (
            turn.role === 'tool'
            && /end_amy_session/i.test(turn.speaker)
            && !/close_not_requested/i.test(turn.content)
        ))) {
            add('missing_end_session_tool', 'critical', index, user.content);
        }
    }

    const deduction = [...new Map(findings.map((item) => [item.code, item.deduction])).values()]
        .reduce((sum, item) => sum + item, 0);
    return {
        status: findings.some((item) => item.severity === 'critical') ? 'fail' : 'pass',
        score: Math.max(0, 100 - deduction),
        findings,
        metrics: {
            assistantTurns: assistantTurns.length,
            userTurns: userTurns.length,
            toolTurns: toolTurns.length,
            maximumAssistantWords: Math.max(0, ...assistantTurns.map((turn) => turn.words)),
            repliesOverSixtyWords: assistantTurns.filter((turn) => turn.words > 60).length,
        },
    };
}
