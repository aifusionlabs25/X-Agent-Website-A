import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { candidateRuntimeConfig } from '../lib/james-canary/runtime-session.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/james-candidate-runtime.json', import.meta.url), 'utf8'));
const prompt = fixture.candidate.brain.systemPrompt;
const guidance = 'For ordinary informational answers, especially after knowledge retrieval, answer in about 10–20 seconds—usually two short spoken sentences, roughly 30–45 words. State the direct source-supported point and the essential caveat once; summarize rather than reciting retrieved stages, lists, or repeated qualifications, and leave secondary detail for follow-up. Go longer when accuracy or safety genuinely requires it. Never skip required retrieval, uncertainty, or qualifying information, and never truncate tool results to meet this target.\n\n';
const hash = value => createHash('sha256').update(value).digest('hex');

test('response-length change is exactly one candidate prompt paragraph', () => {
    assert.equal(prompt.split(guidance).length - 1, 1);
    assert.equal(hash(prompt.replace(guidance, '')),
        'fd6e0ec3322844e745b2a89feb458239eebcfe91d0f03ea2cb69193ed0a2bdfa');
    assert.equal(hash(prompt), '4ff9a5aee9a23b95e1b8c85b7c3ac67869424fff319d786a1aadacbe4958b1b7');
    assert.equal(fixture.resolvedConfig.systemPrompt, prompt);
    assert.match(guidance, /10–20 seconds/);
    assert.match(guidance, /Never skip required retrieval, uncertainty, or qualifying information/);
    assert.match(guidance, /never truncate tool results/);
});

test('source, safety, intake and closing instructions remain in the guarded candidate prompt', () => {
    for (const requirement of [
        'Before answering a general Arizona DUI, criminal-court, or MVD process question, call the approved knowledge tool and wait for its result',
        'Do not give legal advice',
        'Normally ask one focused question at a time',
        'Runtime owns provider state, tool gates, hangup functions, UI state, and termination',
    ]) assert.ok(prompt.includes(requirement), requirement);
    const { config, binding } = candidateRuntimeConfig(structuredClone(fixture.candidate));
    assert.equal(config.systemPrompt, prompt);
    assert.equal(binding.promptHash, hash(prompt));
    assert.deepEqual(config.toolIds, fixture.candidate.tools.filter(tool => tool.name !== 'end_call').map(tool => tool._toolId));
});
