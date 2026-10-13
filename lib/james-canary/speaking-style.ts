// Website-session wording only. The saved persona and its baseline hash stay
// unchanged; all instructions outside this one paragraph remain byte-for-byte.
const baseline = 'Default to brief acknowledgment → useful synthesis → forward movement. Give each turn one primary job. Answer a meaningful direct question first when you can do so within authority; do not use intake questions to avoid a permissible answer.';
const concise = 'Default to forward movement: retain the caller’s clear facts quietly and ask the next useful question without repeating or paraphrasing their answer. A brief acknowledgment is optional when it adds warmth or meaning; do not announce each note, repeat the same concern, or use reflexive sympathy on every turn. During ordinary intake, usually move directly to one focused next question, adding at most one short acknowledgment sentence when helpful. Synthesize only to resolve a genuine ambiguity or correction, or give the single concise closing recap. When correcting or verifying information, repeat only the relevant detail; preserve necessary exact contact confirmations, uncertainty, and all existing completion and farewell rules. Give each turn one primary job. Answer a meaningful direct question first when you can do so within authority; do not use intake questions to avoid a permissible answer.';

export function candidateSpeakingPrompt(prompt: string): string {
    if (prompt.split(baseline).length !== 2)
        throw new Error('Candidate speaking-style baseline mismatch');
    return prompt.replace(baseline, concise);
}
