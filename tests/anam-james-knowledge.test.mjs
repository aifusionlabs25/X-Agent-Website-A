import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await fs.readFile(new URL('../config/anam/james-kb-manifest.json', import.meta.url), 'utf8'));

test('James knowledge manifest is complete, versioned, and privacy-conservative', async () => {
    assert.equal(manifest.bundleVersion, 'JAMES_KB_2026_07_16');
    assert.equal(manifest.knowledgeToolName, 'Knowledge_James_Knowles_Law_Firm_2026_07');
    assert.equal(manifest.memoryEnabled, false);
    assert.equal(manifest.outboundAutomationEnabled, false);
    assert.equal(manifest.legalAdviceContentAllowed, false);
    assert.equal(new Set(manifest.documents).size, manifest.documents.length);
    for (const filename of manifest.documents) {
        const document = await fs.readFile(new URL(`../config/anam/james-kb/${filename}`, import.meta.url), 'utf8');
        assert.ok(document.trim().length > 120, `${filename} must contain useful reviewed knowledge`);
    }
});

test('James firm facts match the reviewed public contact details', async () => {
    const facts = await fs.readFile(new URL('../config/anam/james-kb/01_FIRM_FACTS_AND_CONTACT.md', import.meta.url), 'utf8');
    assert.match(facts, /602-702-5431/);
    assert.match(facts, /2 North Central Avenue, Suite 1800/i);
    assert.match(facts, /2852 South Carriage Lane/i);
    assert.match(facts, /7150 East Camelback, Suite 444/i);
    assert.match(facts, /https:\/\/www\.knowleslaw\.org\//);
});

test('James knowledge contains no legacy provider plumbing or invented scheduling', async () => {
    const combined = (await Promise.all(manifest.documents.map(filename =>
        fs.readFile(new URL(`../config/anam/james-kb/${filename}`, import.meta.url), 'utf8')))).join('\n');
    assert.doesNotMatch(combined, /conversation_id|replica_id|persona_[a-z0-9]{8,}|calendly\.com/i);
    assert.doesNotMatch(combined, /guarantee(?:d)? (?:a )?(?:callback|outcome|result)/i);
});
