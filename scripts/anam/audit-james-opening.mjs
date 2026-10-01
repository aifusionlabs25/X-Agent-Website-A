import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const PERSONA_ID = '8a991c93-0c95-42c5-8c22-a67428946eb8';
const GREETING = "Hi, this is James with Knowles Law Firm. What's going on today?";
const repair = process.argv.includes('--repair');
const snapshotAt = process.argv.indexOf('--snapshot');
const snapshotPath = snapshotAt >= 0 ? process.argv[snapshotAt + 1] : null;
const apiKey = process.env.ANAM_API_KEY?.trim();
assert(apiKey, 'ANAM_API_KEY is required and is never printed.');

function hash(value) {
    return crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
}

async function request(method = 'GET', body) {
    const response = await fetch(`https://api.anam.ai/v1/personas/${PERSONA_ID}`, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
    });
    assert(response.ok, `Anam ${method} failed: HTTP ${response.status}`);
    return response.json();
}

function protectedSettings(persona) {
    return {
        name: persona.name,
        description: persona.description,
        systemPrompt: persona.brain?.systemPrompt,
        personality: persona.brain?.personality,
        avatarId: persona.avatar?.id,
        avatarModel: persona.avatarModel,
        voiceId: persona.voice?.id,
        voiceSpeed: persona.voiceSpeed,
        llmId: persona.llmId,
        tools: persona.tools,
        skipGreeting: persona.skipGreeting,
        uninterruptibleGreeting: persona.uninterruptibleGreeting,
        languageCode: persona.languageCode,
        zeroDataRetention: persona.zeroDataRetention,
        enableAudioPassthrough: persona.enableAudioPassthrough,
        voiceDetectionOptions: persona.voiceDetectionOptions,
        voiceGenerationOptions: persona.voiceGenerationOptions,
        directorNotes: persona.directorNotes,
        widgetConfig: persona.widgetConfig,
        shareLinks: persona.shareLinks,
        primaryShareLink: persona.primaryShareLink,
    };
}

const before = await request();
assert.equal(before.id, PERSONA_ID);
assert.equal(before.skipGreeting, false, 'Greeting is disabled; inspect before changing it.');
assert(before.brain?.systemPrompt?.includes('When a new call starts, you speak first.'), 'Owner prompt opening changed; inspect before repair.');
let after = before;
let changed = false;

if (repair && before.initialMessage !== GREETING) {
    assert(snapshotPath, '--repair requires --snapshot with a saved pre-change configuration.');
    const snapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
    assert.equal(snapshot.id, PERSONA_ID);
    assert.equal(hash(before.initialMessage), hash(snapshot.initialMessage), 'Initial message changed after snapshot; stop to preserve the owner edit.');
    assert.equal(hash(before.brain.systemPrompt), hash(snapshot.systemPrompt), 'System prompt changed after snapshot; inspect before repair.');
    assert(before.initialMessage?.startsWith('SUFFICIENCY CHECK') && before.initialMessage.length > 1_000,
        'This repair only replaces the observed misplaced closing-instructions block.');
    // Partial update: the owner prompt, Knowledge, tools and all other settings stay provider-owned.
    await request('PUT', { initialMessage: GREETING });
    after = await request();
    assert.deepEqual(protectedSettings(after), protectedSettings(before), 'Anam changed a protected setting; inspect the saved snapshot.');
    changed = true;
}

const openingReady = after.skipGreeting === false && after.initialMessage === GREETING;
console.log(JSON.stringify({
    personaId: after.id,
    openingReady,
    changed,
    initialMessage: openingReady ? after.initialMessage : '[invalid opening content omitted]',
    initialMessageChars: after.initialMessage?.length ?? 0,
    skipGreeting: after.skipGreeting,
    systemPromptSha256: hash(after.brain?.systemPrompt),
    ownerPromptPreserved: hash(after.brain?.systemPrompt) === hash(before.brain?.systemPrompt),
    knowledgeAndToolsPreserved: JSON.stringify(after.tools) === JSON.stringify(before.tools),
    avatarId: after.avatar?.id,
    avatarModel: after.avatarModel,
    zeroDataRetention: after.zeroDataRetention,
    publishedAt: after.publishedAt,
    liveAudioVerified: false,
}, null, 2));
if (!openingReady) process.exitCode = 1;
