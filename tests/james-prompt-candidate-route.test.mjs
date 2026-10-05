import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { get, post } from '../lib/james-canary/public-server.ts';
import { JAMES_PROMPT_CANDIDATE_ID } from '../lib/james-canary/prompt-candidate-server.ts';
import { get as legacyGet } from '../lib/james-canary/demo-server.ts';

const CANDIDATE_ID = '016e2c66-166b-43bd-8ebf-70b56c46575c';
const CANONICAL_ID = '8a991c93-0c95-42c5-8c22-a67428946eb8';
const {candidate}=JSON.parse(readFileSync(new URL('./fixtures/james-candidate-runtime.json',import.meta.url),'utf8'));

test('public James uses the bounded runtime without exposing candidate web routes', () => {
    const page = readFileSync(new URL('../app/demo/james-notepad/page.tsx', import.meta.url), 'utf8');
    const api = readFileSync(new URL('../app/api/james-notepad/route.ts', import.meta.url), 'utf8');
    const candidate = readFileSync(new URL('../lib/james-canary/prompt-candidate-server.ts', import.meta.url), 'utf8');
    const productionPage = readFileSync(new URL('../app/demo/james/page.tsx', import.meta.url), 'utf8');
    const player = readFileSync(new URL('../components/james/JamesCanary.tsx', import.meta.url), 'utf8');
    const productionServer = readFileSync(new URL('../lib/james-canary/public-server.ts', import.meta.url), 'utf8');
    const legacyServer = readFileSync(new URL('../lib/james-canary/demo-server.ts', import.meta.url), 'utf8');

    assert.equal(JAMES_PROMPT_CANDIDATE_ID, CANDIDATE_ID);
    assert.equal(existsSync(new URL('../app/demo/james-prompt-candidate/page.tsx',import.meta.url)),false);
    assert.equal(existsSync(new URL('../app/api/james-prompt-candidate/route.ts',import.meta.url)),false);
    assert.equal(existsSync(new URL('../app/api/james-prompt-candidate/recover/route.ts',import.meta.url)),false);
    assert.match(page, /apiPath="\/api\/james-notepad"/);
    assert.match(page, /storageKey="james-notepad-session-v2"/);
    assert.match(player, /if\(clearSavedSessionOnLoad\)localStorage\.removeItem\(storageKey\)/);
    assert.doesNotMatch(player, /localStorage\.clear\(/);
    assert.doesNotMatch(productionPage, /clearSavedSessionOnLoad/);
    assert.match(page, /notepadDemo/);
    assert.match(page, /index: false, follow: false/);
    assert.match(api, /public-server/);
    assert.match(candidate, /personaId: JAMES_PROMPT_CANDIDATE_ID/);
    assert.match(candidate, /xagent_james_prompt_candidate/);
    assert.match(candidate, /xagent:james:prompt-candidate:v1:/);
    assert.doesNotMatch(candidate, new RegExp(CANONICAL_ID));
    assert.match(productionPage, /james-notepad\/page/);
    assert.match(productionServer, /personaId: RUNTIME_CANDIDATE_ID/);
    assert.match(productionServer, /runtimeClose: true/);
    assert.match(productionServer, /xagent_james_notepad_v2/);
    assert.match(productionServer, /xagent:james:notepad:v2:/);
    assert.match(productionServer, /allowEmail: false/);
    assert.match(legacyServer, /personaId: CURRENT_JAMES_PERSONA_ID/);
    assert.match(legacyServer, /xagent:james:notepad-demo:v1:/);
});

test('public launch is server-bound to the bounded persona and cannot read legacy sessions', async () => {
    const previousEnv = { ...process.env };
    const previousFetch = globalThis.fetch;
    Object.assign(process.env, {
        AMY_ANAM_SESSION_SPINE_ENABLED: 'true',
        AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
        AMY_ANAM_SESSION_SECRET: 'test-only-secret-not-real'.repeat(3),
        AMY_ANAM_REDIS_REST_URL: 'https://redis.invalid',
        AMY_ANAM_REDIS_REST_TOKEN: 'fake',
        ANAM_API_KEY: 'fake',
        JAMES_DEMO_EMAIL_ENABLED: 'true',
        JAMES_DEMO_EMAIL_ACCESS_MODE: 'visitor',
        JAMES_DEMO_EMAIL_DAILY_SEND_LIMIT: '1',
        JAMES_AGENTMAIL_API_KEY: 'fake-key-long-enough-for-tests',
        JAMES_AGENTMAIL_ADDRESS: 'james-demo@agentmail.to',
        JAMES_DEMO_REPLY_TO: 'owner@example.test',
    });
    const db = new Map();
    const providerCalls = [];
    globalThis.fetch = async (url, options = {}) => {
        const target = String(url);
        const body = options.body ? JSON.parse(options.body) : null;
        if (target === 'https://redis.invalid/pipeline') return Response.json([{ result: [1, 600] }]);
        if (target === 'https://redis.invalid') {
            if (body[0] === 'GET') return Response.json({ result: db.get(body[1]) ?? null });
            const key = body[3];
            const revision = body[3 + body[2]];
            const encrypted = body[4 + body[2]];
            if (revision !== -1 || db.has(key)) return Response.json({ result: 0 });
            db.set(key, encrypted);
            return Response.json({ result: 1 });
        }
        providerCalls.push(target);
        if (target === `https://api.anam.ai/v1/personas/${CANDIDATE_ID}`) {
            return Response.json(candidate);
        }
        if (target === 'https://api.anam.ai/v1/auth/session-token') {
            const config=body.personaConfig;
            assert.equal(config.personaId,undefined);
            assert.equal(config.systemPrompt,candidate.brain.systemPrompt);
            assert.equal(config.avatarId,candidate.avatar.id);
            assert.equal(config.voiceId,candidate.voice.id);
            assert.equal(config.llmId,candidate.llmId);
            assert.equal(config.tools,undefined);
            assert.deepEqual(config.toolIds,candidate.tools.filter(t=>t.name!=='end_call').map(t=>t._toolId));
            assert.ok(!config.toolIds.includes(candidate.tools.find(t=>t.name==='end_call')._toolId));
            for(const key of ['avatarModel','languageCode','initialMessage','skipGreeting','uninterruptibleGreeting',
                'zeroDataRetention','directorNotes','voiceDetectionOptions','voiceGenerationOptions','enableAudioPassthrough'])
                assert.deepEqual(config[key],candidate[key],key);
            return Response.json({ sessionToken: 'fake-session-token' });
        }
        throw new Error(`Unexpected network target ${target}`);
    };

    try {
        const request = new Request('https://demo.invalid/api/james-notepad', {
            method: 'POST',
            headers: { origin: 'https://demo.invalid', 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'start', personaId: CANONICAL_ID }),
        });
        const response = await post(request);
        const launched = await response.json();
        assert.equal(response.status, 200, JSON.stringify(launched));
        assert.equal(launched.personaId, CANDIDATE_ID);
        assert.equal(launched.sessionToken, 'fake-session-token');
        assert.equal(launched.demo_email_authorized, false);
        assert.ok(launched.intakeBrief, 'notes-only launch must retain the structured brief');
        const cookie = response.headers.get('set-cookie').split(';')[0];
        assert.match(cookie, /^xagent_james_notepad_v2=/);
        for (const action of ['demo-email-preflight', 'preview-demo-email', 'send-demo-email']) {
            const blocked = await post(new Request('https://demo.invalid/api/james-notepad', {
                method: 'POST',
                headers: { origin: 'https://demo.invalid', 'Content-Type': 'application/json', cookie },
                body: JSON.stringify({ action, id: launched.id }),
            }));
            assert.equal(blocked.status, 400);
            assert.match((await blocked.json()).error, /Demo email is unavailable on this surface/);
        }
        assert.ok([...db.keys()].every(key => key.startsWith('xagent:james:notepad:v2:')));
        assert.deepEqual(providerCalls, [
            `https://api.anam.ai/v1/personas/${CANDIDATE_ID}`,
            'https://api.anam.ai/v1/auth/session-token',
        ]);

        const url = `https://demo.invalid/api/james-notepad?id=${launched.id}`;
        const candidateRead = await get(new Request(url, { headers: { cookie } }));
        assert.equal(candidateRead.status, 200);
        assert.equal((await candidateRead.json()).personaId, CANDIDATE_ID);
        const legacyRead = await legacyGet(new Request(url, { headers: { cookie } }));
        assert.equal(legacyRead.status, 400);
    } finally {
        globalThis.fetch = previousFetch;
        for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
        Object.assign(process.env, previousEnv);
    }
});

test('candidate-only development diagnostic logs the failed Anam step without secrets or retries', async () => {
    const previousEnv={...process.env}, previousFetch=globalThis.fetch, previousWarn=console.warn;
    Object.assign(process.env,{
        NODE_ENV:'development',AMY_ANAM_SESSION_SPINE_ENABLED:'true',AMY_ANAM_SESSION_SPINE_KILL_SWITCH:'false',
        AMY_ANAM_SESSION_SECRET:'test-only-secret-not-real'.repeat(3),
        AMY_ANAM_REDIS_REST_URL:'https://redis.invalid',AMY_ANAM_REDIS_REST_TOKEN:'fake-redis-token',
        ANAM_API_KEY:'fake-anam-secret',JAMES_DEMO_EMAIL_ENABLED:'false',
    });
    const calls=[],warnings=[];
    console.warn=(...args)=>warnings.push(args);
    globalThis.fetch=async (url)=>{
        const target=String(url);calls.push(target);
        if(target==='https://redis.invalid/pipeline')return Response.json([{result:[1,600]}]);
        if(target===`https://api.anam.ai/v1/personas/${CANDIDATE_ID}`)
            return Response.json({error:{code:'BAD_CONFIG',message:'fake-anam-secret user@example.com',
                request:{systemPrompt:'must not appear'}}},{status:400});
        throw new Error(`Unexpected network target ${target}`);
    };
    try {
        const response=await post(new Request('https://demo.invalid/api/james-notepad',{
            method:'POST',headers:{origin:'https://demo.invalid','Content-Type':'application/json'},
            body:JSON.stringify({action:'start'}),
        }));
        assert.equal(response.status,400);
        assert.deepEqual(calls,['https://redis.invalid/pipeline',`https://api.anam.ai/v1/personas/${CANDIDATE_ID}`]);
        assert.equal(warnings.length,1);
        assert.equal(warnings[0][0],'[james-candidate-anam-error]');
        const entry=JSON.parse(warnings[0][1]);
        assert.equal(entry.step,'persona-fetch');
        assert.equal(entry.status,400);
        assert.match(entry.body,/BAD_CONFIG/);
        assert.doesNotMatch(entry.body,/fake-anam-secret|user@example.com|systemPrompt|must not appear/);
    } finally {
        globalThis.fetch=previousFetch;console.warn=previousWarn;
        for(const key of Object.keys(process.env))if(!(key in previousEnv))delete process.env[key];
        Object.assign(process.env,previousEnv);
    }
});
