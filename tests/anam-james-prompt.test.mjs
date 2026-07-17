import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const prompt = await fs.readFile(new URL('../config/anam/james-system-prompt.md', import.meta.url), 'utf8');

test('James prompt has a versioned managed boundary and explicit AI/legal limits', () => {
    assert.match(prompt, /JAMES_CANONICAL_SP_START/);
    assert.match(prompt, /JAMES_ANAM_SP_2026_07_16/);
    assert.match(prompt, /AI legal-intake assistant/i);
    assert.match(prompt, /not a lawyer/i);
    assert.match(prompt, /do not provide legal advice/i);
    assert.match(prompt, /does not submit a case or schedule a consultation/i);
});

test('James prompt covers the verified practice scope without inventing legal guidance', () => {
    assert.match(prompt, /criminal defense/i);
    assert.match(prompt, /DUI defense/i);
    assert.match(prompt, /personal injury/i);
    assert.match(prompt, /do not calculate a deadline/i);
    assert.match(prompt, /Do not estimate case value/i);
    assert.match(prompt, /602-702-5431/);
});

test('James prompt excludes Tavus mechanics and legacy unsupported actions', () => {
    assert.doesNotMatch(prompt, /tavus|replica|conversation_id/i);
    assert.doesNotMatch(prompt, /calendly/i);
    assert.doesNotMatch(prompt, /PracticePanther|Filevine|Clio/i);
    assert.doesNotMatch(prompt, /pretend (?:you are|to be) human|not an AI/i);
});
