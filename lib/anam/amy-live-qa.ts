import {
    hasAmySoftCloseIntent,
    hasExplicitAmyCloseIntent,
} from './amy-session-close.ts';

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
    | 'executive_interview_drift'
    | 'tool_retry_storm'
    | 'unsupported_human_followup'
    | 'visual_capability_mismatch'
    | 'prohibited_live_catalog_lookup'
    | 'premature_close_attempt'
    | 'failed_end_session_receipt'
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
const SOFT_COMPLETION = /\b(?:that(?:'s| is) what i needed|i(?:'ll| will) take this forward|i(?:'ll| will) run with this)\b/i;
const TOOL_MARKUP = /<\s*end_(?:call|amy_session)\b|\bend_(?:call|amy_session)\s*\{/i;
const CUSTOMER_EVIDENCE_REQUEST = /\b(?:case stud(?:y|ies)|customer (?:example|reference|story)|similar (?:customer|client|organization|public[- ]sector environment)|what Insight has done|proof point|prior outcome)\b/i;
const CAPABILITY_INTERVIEW = /\b(?:evaluat(?:e|ing)|interview(?:ing)?|reviewing|testing)\b[\s\S]{0,120}\b(?:you|Amy|X[ -]?Agent)\b|\b(?:what (?:exactly )?(?:can|do) you do|what are you(?: here)? for|how do you work|tell me (?:what you do|about yourself)|why (?:do you|should (?:Insight|we)) (?:matter|use you))\b/i;
const LIVE_OPPORTUNITY_TRANSITION = /\b(?:let(?:'s| us) role[ -]?play|pretend (?:I am|I'm|we are|we're)|real (?:customer|client|opportunity)|actual (?:customer|client|opportunity)|we have (?:a|an|the) (?:customer|client|opportunity)|our (?:customer|client) (?:needs|wants|has|is))\b/i;
const GENERIC_PROSPECT_QUALIFICATION = /\b(?:what(?:'s| is) (?:the )?(?:primary )?(?:outcome|result|goal) (?:you(?:'d| would) like|you are|you're)|what (?:business )?(?:outcome|result|goal) are you (?:hoping|trying|looking) to (?:achieve|see)|what would be most useful (?:for us )?to work through|which part of (?:the )?.{0,60} are you focusing on)\b/i;
const CAPABILITY_VISUAL_REQUEST = /\bshow me\b[\s\S]{0,100}\b(?:Insight Intelligence Layer|how you work|what you can do|your capabilities|your capability)\b/i;
const LIVE_PRODUCT_DATA_REQUEST = /\b(?:SKU|part(?:[ -]?number|\s*#)|live (?:catalog|products?|inventory)|inventory|in stock|stock status|pricing|price|lead[ -]?time|contract eligibility)\b/i;
const LIVE_CATALOG_TOOL = /(?:catalog|product.*lookup|lookup.*product|sku|part(?:_|-)?number|inventory|pricing)/i;
const UNSUPPORTED_HUMAN_FOLLOWUP = /\b(?:(?:an? )?(?:Insight )?(?:team member|specialist|representative|human|person)|someone (?:at|from) Insight|the Insight team)\s+(?:will|is going to|has been assigned to)\s+(?:review|follow(?:\s+up)?|contact|reach out|call|email|take (?:this|it) forward)|you(?:'ll| will)\s+(?:hear from|be contacted by)\s+(?:an? )?(?:Insight )?(?:team member|specialist|representative|human|person)\b/i;
const HUMAN_FOLLOWUP_NEGATION = /\b(?:cannot|can't|do not|don't|not able to|no guarantee|would need to|material to review)\b/i;
const TERMINAL_END_RECEIPT = /\b(?:closing_motion_and_farewell_required|farewell_required|session_ended)\b/i;
const FAILED_END_RECEIPT = /\b(?:close_not_requested|close_in_progress|farewell_already_armed|error|failed|failure|timeout|timed_out|unavailable|rejected)\b/i;

function countWords(value: string): number {
    return value.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function excerpt(value: string): string {
    const clean = value.replace(/\s+/g, ' ').trim();
    return clean.length <= 180 ? clean : `${clean.slice(0, 179).trimEnd()}…`;
}

function toolName(turn: Turn): string | null {
    if (turn.role !== 'tool') return null;
    return turn.speaker.match(/^Tool\s*\(([^)]+)\)/i)?.[1]?.trim().toLowerCase() ?? null;
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
    executive_interview_drift: 30,
    tool_retry_storm: 30,
    unsupported_human_followup: 30,
    visual_capability_mismatch: 30,
    prohibited_live_catalog_lookup: 35,
    premature_close_attempt: 30,
    failed_end_session_receipt: 30,
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
            if (priorUser && SOFT_COMPLETION.test(priorUser.content) && !hasExplicitAmyCloseIntent(priorUser.content)) {
                add('premature_close_attempt', 'critical', index, priorUser.content);
            }
        }
        if (/\bthe visual brief is now open\b[\s\S]{0,100}\bthe visual brief is now open\b/i.test(assistant.content)) {
            add('duplicate_visual_confirmation', 'warning', index, assistant.content);
        }
        if (/\bwe(?:'ll| will) work with you to\b|\b(?:an )?Insight specialist can\b.{0,100}\b(?:draft|deliver|create)\b.{0,80}\b(?:detailed|tailored|modernization)\b/i.test(assistant.content)) {
            add('unsupported_service_commitment', 'critical', index, assistant.content);
        }
        if (UNSUPPORTED_HUMAN_FOLLOWUP.test(assistant.content) && !HUMAN_FOLLOWUP_NEGATION.test(assistant.content)) {
            add('unsupported_human_followup', 'critical', index, assistant.content);
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

    let capabilityInterviewActive = false;
    for (const [index, turn] of turns.entries()) {
        if (turn.role === 'user') {
            if (CAPABILITY_INTERVIEW.test(turn.content)) capabilityInterviewActive = true;
            else if (capabilityInterviewActive && LIVE_OPPORTUNITY_TRANSITION.test(turn.content)) capabilityInterviewActive = false;
        } else if (turn.role === 'assistant' && capabilityInterviewActive && GENERIC_PROSPECT_QUALIFICATION.test(turn.content)) {
            add('executive_interview_drift', 'critical', index, turn.content);
        }
    }

    for (const [index, turn] of turns.entries()) {
        if (turn.role !== 'user') continue;
        const nextUserIndex = turns.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.role === 'user');
        const responseTurns = turns.slice(index + 1, nextUserIndex < 0 ? turns.length : nextUserIndex);
        const callsByName = new Map<string, Turn[]>();
        for (const responseTurn of responseTurns) {
            const name = toolName(responseTurn);
            if (!name || name === 'end_amy_session') continue;
            const calls = callsByName.get(name) ?? [];
            calls.push(responseTurn);
            callsByName.set(name, calls);
        }
        for (const [name, calls] of callsByName) {
            if (calls.length > 1) add('tool_retry_storm', 'critical', turns.indexOf(calls[1]), `${name} called ${calls.length} times before the visitor spoke again.`);
        }
        if (CAPABILITY_VISUAL_REQUEST.test(turn.content)
            && responseTurns.some((candidate) => toolName(candidate) === 'show_visual_brief')) {
            add('visual_capability_mismatch', 'critical', index, turn.content);
        }
        if (LIVE_PRODUCT_DATA_REQUEST.test(turn.content)) {
            const prohibitedCall = responseTurns.find((candidate) => {
                const name = toolName(candidate);
                return Boolean(name && LIVE_CATALOG_TOOL.test(name));
            });
            if (prohibitedCall) {
                add('prohibited_live_catalog_lookup', 'critical', turns.indexOf(prohibitedCall), turn.content);
            }
        }
    }

    const endTurns = turns
        .map((turn, index) => ({ turn, index }))
        .filter(({ turn }) => toolName(turn) === 'end_amy_session');
    for (const { turn, index } of endTurns) {
        const priorUser = [...turns.slice(0, index)].reverse().find((candidate) => candidate.role === 'user');
        const closeRequested = Boolean(priorUser
            && (hasExplicitAmyCloseIntent(priorUser.content) || hasAmySoftCloseIntent(priorUser.content)));
        if (!closeRequested) add('premature_close_attempt', 'critical', index, priorUser?.content ?? turn.content);
        if (FAILED_END_RECEIPT.test(turn.content) && closeRequested) {
            add('failed_end_session_receipt', 'critical', index, turn.content);
        }
        if (TERMINAL_END_RECEIPT.test(turn.content)
            && turns.slice(index + 1).some((candidate) => candidate.role === 'user')) {
            add('failed_end_session_receipt', 'critical', index, turn.content);
        }
    }
    if (endTurns.length > 1) {
        add(
            'failed_end_session_receipt',
            'critical',
            endTurns[1].index,
            `end_amy_session was called ${endTurns.length} times in one session.`,
        );
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
        if (!hasExplicitAmyCloseIntent(user.content) && !hasAmySoftCloseIntent(user.content)) continue;
        if (!turns.slice(index + 1).some((turn) => toolName(turn) === 'end_amy_session'
            && TERMINAL_END_RECEIPT.test(turn.content))) {
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
