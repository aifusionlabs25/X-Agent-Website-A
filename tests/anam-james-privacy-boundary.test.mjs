import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const transcriptRoute = await fs.readFile(new URL('../app/api/save-transcript/route.ts', import.meta.url), 'utf8');
const agents = await fs.readFile(new URL('../lib/agents.ts', import.meta.url), 'utf8');

test('James transcript suppression occurs before storage, LLM, Sheets, and email processing', () => {
    const suppression = transcriptRoute.indexOf("agent.slug === 'james'");
    assert.ok(suppression > 0);
    for (const laterBoundary of [
        "path.join(process.cwd(), 'transcripts')",
        'analyzeTranscript(',
        'appendLead(',
        'new Resend(',
    ]) {
        assert.ok(transcriptRoute.indexOf(laterBoundary) > suppression, `${laterBoundary} must be after James suppression`);
    }
    assert.match(transcriptRoute.slice(suppression, transcriptRoute.indexOf("if (variant", suppression)), /outbound: false/);
});

test('James public profile is explicit about AI, legal limits, and disabled automations', () => {
    assert.match(agents, /James is an AI intake assistant/);
    assert.match(agents, /does not create an attorney-client relationship/);
    assert.match(agents, /No submission, email, CRM, or scheduling/);
});
