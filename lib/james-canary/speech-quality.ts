/** Diagnostic only. SDK text events arrive alongside independently streamed
 * audio, so this must never be described as a spoken-output filter. */
export function instructionLeakageSuspected(turns: { role: string; content: string }[]): boolean {
    return turns.some(turn => turn.role === 'persona' && (
        /<\/?(?:think|analysis|reasoning)>|\[start\]|\[channel\]|<\|(?:im_start|im_sep|im_end|channel)\|>/i.test(turn.content)
        || /\b(?:SUFFICIENCY CHECK|FINAL SILENT CHECK|HARD EVAL|OPERATING PRIORITIES|system prompt|internal instructions|internal notes)\b/i.test(turn.content)
        || /\bI (?:must|need to|should) follow (?:the|my) (?:system|developer) instructions\b/i.test(turn.content)
    ));
}
