export const AMY_CONVERSATION_START_MARKER = '<!-- AMY_CONVERSATION_NATURALNESS_START -->';
export const AMY_CONVERSATION_END_MARKER = '<!-- AMY_CONVERSATION_NATURALNESS_END -->';

const normalize = value => String(value ?? '').replace(/\r\n?/g, '\n');

export function installAmyConversationBlock(prompt, replacement) {
    const current = normalize(prompt).trim();
    const managed = normalize(replacement).trim();
    const start = current.indexOf(AMY_CONVERSATION_START_MARKER);
    const end = current.indexOf(AMY_CONVERSATION_END_MARKER);
    if ((start >= 0) !== (end >= 0) || (start >= 0 && end <= start)) {
        throw new Error('Refusing update: Amy conversation prompt markers are malformed.');
    }
    if (start >= 0) {
        const tail = current.slice(end + AMY_CONVERSATION_END_MARKER.length).trim();
        const before = current.slice(0, start).trim();
        return `${managed}${before ? `\n\n${before}` : ''}${tail ? `\n\n${tail}` : ''}\n`;
    }
    return `${managed}\n\n${current}\n`;
}
