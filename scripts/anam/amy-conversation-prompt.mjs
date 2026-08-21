export const AMY_CONVERSATION_START_MARKER = '<!-- AMY_CONVERSATION_NATURALNESS_START -->';
export const AMY_CONVERSATION_END_MARKER = '<!-- AMY_CONVERSATION_NATURALNESS_END -->';

const normalize = value => String(value ?? '').replace(/\r\n?/g, '\n');

function markerPositions(value, marker) {
    const positions = [];
    let cursor = 0;
    while (cursor <= value.length) {
        const position = value.indexOf(marker, cursor);
        if (position < 0) break;
        positions.push(position);
        cursor = position + marker.length;
    }
    return positions;
}

function locateConversationBlock(value, required) {
    const starts = markerPositions(value, AMY_CONVERSATION_START_MARKER);
    const ends = markerPositions(value, AMY_CONVERSATION_END_MARKER);
    if (!required && starts.length === 0 && ends.length === 0) return null;
    if (starts.length !== 1 || ends.length !== 1 || ends[0] <= starts[0]) {
        throw new Error('Refusing update: Amy conversation prompt markers are malformed.');
    }
    return { start: starts[0], end: ends[0] };
}

export function removeDeprecatedAmyBehaviorBlock(prompt, deprecatedBlock) {
    const current = normalize(prompt).trim();
    const deprecated = normalize(deprecatedBlock).trim();
    if (!deprecated) throw new Error('Refusing update: deprecated Amy behavior block is empty.');
    const exactMatches = current.split(deprecated).length - 1;
    const headerMatches = current.split('# Amy Cara 4 behavior upgrade').length - 1;
    if (exactMatches > 1 || (headerMatches > 0 && exactMatches !== 1)) {
        throw new Error('Refusing update: deprecated Amy behavior block is malformed or differs from the reviewed source.');
    }
    if (exactMatches === 0) return { prompt: `${current}\n`, removed: false };

    const start = current.indexOf(deprecated);
    const before = current.slice(0, start).trim();
    const after = current.slice(start + deprecated.length).trim();
    return {
        prompt: `${[before, after].filter(Boolean).join('\n\n')}\n`,
        removed: true,
    };
}

export function installAmyConversationBlock(prompt, replacement) {
    const current = normalize(prompt).trim();
    const managed = normalize(replacement).trim();
    const replacementBlock = locateConversationBlock(managed, true);
    if (replacementBlock.start !== 0
        || replacementBlock.end + AMY_CONVERSATION_END_MARKER.length !== managed.length) {
        throw new Error('Refusing update: Amy conversation prompt markers are malformed.');
    }
    const currentBlock = locateConversationBlock(current, false);
    if (currentBlock) {
        const tail = current.slice(currentBlock.end + AMY_CONVERSATION_END_MARKER.length).trim();
        const before = current.slice(0, currentBlock.start).trim();
        return `${managed}${before ? `\n\n${before}` : ''}${tail ? `\n\n${tail}` : ''}\n`;
    }
    return `${managed}\n\n${current}\n`;
}
