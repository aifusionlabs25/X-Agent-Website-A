import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { unseal, createJamesServer } from '../lib/james-canary/server.ts';
import { RUNTIME_CANDIDATE_ID } from '../lib/james-canary/runtime-session.ts';
import { INTERNAL_DEMO_RECIPIENT } from '../lib/james-canary/demo-email.ts';
import { sha } from '../lib/james-canary/state.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/james-candidate-runtime.json', import.meta.url), 'utf8'));
const prefix = 'xagent:james:notepad:v2:';
const providerId = '4056f1c6-bd11-4682-bcc8-fddcbc8fa22e';
const signingSecret = 'offline-public-email-signing-secret'.repeat(3);
const redisUrl = 'https://james-public-email-redis.invalid';
let importSequence = 0;

/** Every fetch target is intercepted. The real route, AES envelope, signed
 * browser cookie, optimistic revisions, quota and mail adapter run locally. */
async function withPublicRoute(options, run) {
    const originalEnv = { ...process.env }, originalFetch = globalThis.fetch;
    Object.assign(process.env, {
        AMY_ANAM_SESSION_SPINE_ENABLED: 'true', AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
        AMY_ANAM_SESSION_SECRET: signingSecret, AMY_ANAM_REDIS_REST_URL: redisUrl,
        AMY_ANAM_REDIS_REST_TOKEN: 'offline-redis-token', ANAM_API_KEY: 'offline-anam-key',
        JAMES_PUBLIC_DEMO_EMAIL_ENABLED: 'true', JAMES_DEMO_EMAIL_ENABLED: 'true',
        JAMES_DEMO_EMAIL_BUNDLE: 'three', JAMES_DEMO_EMAIL_RECIPIENT_MODE: options.recipientMode || 'owner',
        JAMES_DEMO_EMAIL_ACCESS_MODE: 'visitor', JAMES_DEMO_EMAIL_DAILY_SEND_LIMIT: '25',
        JAMES_AGENTMAIL_API_KEY: 'offline-agentmail-key-not-real',
        JAMES_AGENTMAIL_ADDRESS: 'james-demo@agentmail.to', JAMES_DEMO_REPLY_TO: INTERNAL_DEMO_RECIPIENT,
        ...options.env,
    });
    for (const name of options.unset || []) delete process.env[name];
    const key = createHmac('sha256', signingSecret).update(prefix).digest('hex');
    const db = new Map(), index = new Set(), messages = [], sends = [], requests = [];
    let currentId, cookie = '', mintedConfig, released = false, endedAt, launches = 0, inboxReads = 0;
    const stored = () => unseal(db.get(prefix + currentId), currentId, key, RUNTIME_CANDIDATE_ID, prefix);
    globalThis.fetch = async (url, init = {}) => {
        const target = String(url), body = init.body ? JSON.parse(init.body) : null;
        requests.push({ target, method: init.method || 'GET' });
        if (target === redisUrl + '/pipeline') return Response.json([{ result: [1, 600] }]);
        if (target === redisUrl) {
            if (body[0] === 'GET') return Response.json({ result: db.get(body[1]) ?? null });
            if (body[0] === 'SET') {
                if (db.has(body[1])) return Response.json({ result: null });
                db.set(body[1], body[2]); return Response.json({ result: 'OK' });
            }
            if (body[0] === 'EVAL' && String(body[3]).startsWith(prefix + 'demo-email-budget:')) {
                const total = Number(db.get(body[3]) || 0), recipient = Number(db.get(body[4]) || 0);
                if (total >= body[5] || recipient >= body[6]) return Response.json({ result: 0 });
                db.set(body[3], String(total + 1)); db.set(body[4], String(recipient + 1));
                return Response.json({ result: 1 });
            }
            if (body[0] === 'EVAL') {
                assert.equal(body[2], 2); assert.equal(body[4], prefix + 'reconcile:index');
                const [, , , sessionKey, , revision, encoded] = body;
                const old = db.get(sessionKey);
                if ((revision === -1 && old) || (revision !== -1 && (!old || JSON.parse(old).revision !== revision))) {
                    return Response.json({ result: 0 });
                }
                assert.ok(!encoded.includes('Maya Patel'), 'session contents must remain AES encrypted');
                db.set(sessionKey, encoded);
                if (body[8] === 'track') index.add(body[10]);
                if (body[8] === 'remove') index.delete(body[10]);
                return Response.json({ result: 1 });
            }
            throw new Error('Unexpected mocked Redis operation ' + body[0]);
        }
        if (target === 'https://api.anam.ai/v1/personas/' + RUNTIME_CANDIDATE_ID) {
            return Response.json(structuredClone(fixture.candidate));
        }
        if (target === 'https://api.anam.ai/v1/auth/session-token') {
            launches++; mintedConfig = body.personaConfig;
            currentId = body.clientLabel.slice('xagent-james-notepad:'.length);
            assert.equal(stored().personaId, RUNTIME_CANDIDATE_ID);
            assert.equal(stored().runtimeBinding.promptHash, sha(mintedConfig.systemPrompt));
            return Response.json({ sessionToken: 'offline-session-token' });
        }
        if (target === 'https://api.anam.ai/v1/sessions/' + providerId) {
            const session = stored(), config = structuredClone(fixture.resolvedConfig);
            config.systemPrompt = mintedConfig.systemPrompt;
            config.llmConfig = { id: session.runtimeBinding.llmId, modelName: 'qwen/qwen3.6-27b' };
            return Response.json({ id: providerId, personaId: null, clientLabel: session.clientLabel,
                startTime: session.createdAt, endTime: released ? endedAt : null,
                exitStatus: released ? 'OK' : null, personaConfig: config });
        }
        if (target === 'https://api.anam.ai/v1/sessions/' + providerId + '/transcript') {
            assert.equal(released, true);
            if(options.transcriptFails)return new Response('offline failure',{status:500});
            return Response.json({ sessionId: providerId, transcriptsEnabled: true,
                totalMessages: messages.length, messages, endTime: endedAt });
        }
        if(target==='https://api.anam.ai/v1/sessions/'+providerId+'/stop'){
            released=true;endedAt=new Date().toISOString();return Response.json({ok:true});
        }
        if (target === 'https://api.agentmail.to/v0/inboxes/james-demo%40agentmail.to') {
            inboxReads++;
            if (options.preflightFails) throw new Error('Offline simulated mail outage');
            return Response.json({ email: 'james-demo@agentmail.to', display_name: 'AI Fusion Labs Demo' });
        }
        if (target === 'https://api.agentmail.to/v0/inboxes/james-demo%40agentmail.to/messages/send') {
            const session = stored(), lanes = ['internal', 'caller', 'admin'];
            assert.equal(session.state, 'CLOSED'); assert.ok(session.providerRelease);
            assert.ok(session.demoEmail.consentAt);
            for (const [position, lane] of lanes.entries()) {
                assert.equal(session.demoEmail.deliveries[lane].status, position < sends.length ? 'SENT' : 'RESERVED');
            }
            assert.equal(body.track_opens, false); assert.equal(body.cc, undefined); assert.equal(body.bcc, undefined);
            sends.push({ body, idempotencyKey: init.headers['Idempotency-Key'] });
            return Response.json({ message_id: 'offline-accepted-' + sends.length });
        }
        throw new Error('Unexpected network target; no real request permitted: ' + target);
    };
    try {
        const tasks=[];
        const { createPublicJamesServer } = await import(new URL('../lib/james-canary/public-server.ts?offline-email=' + (++importSequence), import.meta.url));
        const {get,post}=options.manual?createJamesServer({personaId:RUNTIME_CANDIDATE_ID,cookie:'xagent_james_notepad_v2',prefix,allowDemoEmail:true,allowEmail:true,runtimeClose:true,allowBrowserRecovery:true})
            :createPublicJamesServer(task=>tasks.push(task));
        const request = (body, auth = cookie, origin = 'https://demo.invalid') => new Request('https://demo.invalid/api/james-notepad', {
            method: 'POST', headers: { origin, 'Content-Type': 'application/json', ...(auth ? { cookie: auth } : {}) },
            body: JSON.stringify(body),
        });
        const postResult = async (action, extra = {}, auth = cookie) => {
            const response = await post(request({ action, ...(currentId ? { id: currentId } : {}), ...extra }, auth));
            const data = await response.json(); return { status: response.status, data, response };
        };
        const action = async (operation, extra = {}) => {
            const result = await postResult(operation, extra);
            assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data;
        };
        const start = async () => {
            const result = await postResult('start'); assert.equal(result.status, 200, JSON.stringify(result.data));
            cookie = result.response.headers.get('set-cookie').split(';')[0];
            assert.ok(cookie.startsWith('xagent_james_notepad_v2='));
            return result.data;
        };
        const turn = async (role, content) => {
            const turn = { id: 'offline-turn-' + messages.length, role, content };
            const state = await action('turn', { turn, finalized: true });
            messages.push({ role, message: content }); return state;
        };
        const closeComplete = async () => {
            await action('bind', { providerId });
            await turn('persona', 'What happened?');
            await turn('user', 'A contractor left my kitchen torn apart. I paid a $4,000 deposit. I want my $4,000 back.');
            await turn('user', 'The payment was on August 3rd. He is not answering my calls. I have a text message agreement and bank transfer receipt. My kitchen is unusable.');
            await turn('persona', 'What is your full name and callback number?');
            await turn('user', 'My name is Maya Patel. My phone number is 480-555-0177. My email is maya@example.test.');
            await turn('persona', 'Is maya@example.test the correct email address?');
            await turn('user', 'Yes.');
            assert.equal((await postResult('preview-demo-email')).status, 400);
            const departure = await turn('user', 'Thanks, James. Goodbye.');
            const pending = await turn('persona', 'You’re welcome. Take care.');
            assert.equal(pending.state, 'CLOSING_PENDING');
            await action('begin-close', { automatic: true, departureTurnId: departure.websiteClosing.departureTurnId,
                signal: 'AUDIO_QUIET', revision: pending.revision });
            messages.push({ role: 'persona', message: 'Additional provider-only final transcript context.' });
            released = true; endedAt = new Date().toISOString();
            const closed = await action('close'); assert.equal(closed.state, 'CLOSED');
            assert.equal(sends.length, 0, 'closure must never send automatically');
            return closed;
        };
        const confirmComplete = async (closed) => {
            let current = closed;
            for (const [slot, value] of [['name', 'Maya Patel'], ['phone', '480-555-0177'], ['location', 'Phoenix']]) {
                current = await action('correct-brief', { slot, value, snapshotHash: current.intakeBrief.hash });
            }
            assert.deepEqual(current.intakeBrief.missing, []);
            current = await action('confirm-brief', { snapshotHash: current.intakeBrief.hash });
            assert.equal(current.intakeBrief.phase, 'CONFIRMED'); assert.equal(current.readiness.ready, true);
            return current;
        };
        await run({ start, turn, closeComplete, confirmComplete, action, postResult, stored, db, sends, messages,
            drain:async()=>{while(tasks.length)await tasks.shift()();},tasks,
            ended:()=>{released=true;endedAt=new Date().toISOString();},
            launches: () => launches, inboxReads: () => inboxReads,
            getView: async (auth = cookie) => {
                const response = await get(new Request('https://demo.invalid/api/james-notepad?id=' + currentId, { headers: auth ? { cookie: auth } : {} }));
                return { status: response.status, data: await response.json() };
            }, requests });
    } finally {
        globalThis.fetch = originalFetch;
        for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
        Object.assign(process.env, originalEnv);
    }
}

test('public runtime three-email lifecycle requires verified close, confirmed notes and exact explicit approval; replay sends nothing', async () => {
    await withPublicRoute({manual:true}, async h => {
        const launched = await h.start(); assert.equal(launched.demo_email_authorized, true);
        assert.equal(h.stored().demoEmail.bundle, 'three'); assert.equal(h.stored().demoEmail.recipientMode, 'owner');
        assert.equal(h.sends.length, 0);
        const closed = await h.closeComplete();
        assert.equal(closed.providerTranscript, undefined);
        assert.ok(!JSON.stringify(closed).includes('Additional provider-only final transcript context.'));
        assert.equal(h.stored().providerTranscript.length, h.messages.length);
        assert.equal(h.stored().providerRelease.transcriptHash, sha(JSON.stringify(h.stored().providerTranscript)));
        assert.equal((await h.postResult('preview-demo-email')).status, 400, 'unconfirmed current brief blocks email');
        await h.confirmComplete(closed);
        const preview = await h.action('preview-demo-email');
        assert.match(preview.messageHash, /^[a-f0-9]{64}$/);
        assert.deepEqual(preview.messages.map(m => m.lane), ['caller', 'internal', 'admin']);
        assert.ok(preview.messages.every(m => m.to === INTERNAL_DEMO_RECIPIENT));
        const attachment = preview.messages.find(m => m.lane === 'internal').attachments[0];
        assert.match(attachment.filename, /^james-transcript-.*\.txt$/);
        assert.match(attachment.text, /Additional provider-only final transcript context\./);
        assert.match(attachment.text, /My name is Maya Patel\./);
        assert.equal(h.sends.length, 0, 'previews never send');
        const consent = { snapshotHash: preview.snapshotHash, messageHash: preview.messageHash, callerAddress: preview.callerAddress, approved: true };
        for (const changed of [{ ...consent, messageHash: undefined }, { ...consent, messageHash: '0'.repeat(64) },
            { ...consent, approved: false }, { ...consent, callerAddress: 'someone-else@example.test' }]) {
            assert.equal((await h.postResult('send-demo-email', changed)).status, 400);
            assert.equal(h.sends.length, 0); assert.equal(h.stored().demoEmail.deliveries, undefined);
        }
        assert.equal((await h.postResult('send-demo-email', consent, '')).status, 400, 'caller browser ownership remains required');
        const sent = await h.action('send-demo-email', consent);
        assert.equal(h.sends.length, 3); assert.equal(new Set(h.sends.map(s => s.idempotencyKey)).size, 3);
        assert.deepEqual(sent.demo_email_status.map(d => d.status), ['SENT', 'SENT', 'SENT']);
        assert.equal(sent.external_actions.length, 3);
        assert.equal(h.sends[0].body.attachments[0].content_type, 'text/plain');
        assert.equal(Buffer.from(h.sends[0].body.attachments[0].content, 'base64').toString('utf8'), attachment.text);
        assert.equal(h.sends[1].body.attachments, undefined); assert.equal(h.sends[2].body.attachments, undefined);
        assert.equal(h.db.get(prefix + 'demo-email-budget:total'), '1');
        assert.equal(h.db.get(prefix + 'demo-email-budget:recipient:' + sha('maya@example.test')), '1');
        await h.action('send-demo-email', {}); await h.action('send-demo-email', consent);
        assert.equal(h.sends.length, 3); assert.equal(h.db.get(prefix + 'demo-email-budget:total'), '1');
        const restored = await h.getView(); assert.equal(restored.status, 200); assert.deepEqual(restored.data, sent);
        assert.equal(restored.data.providerTranscript, undefined);
        assert.ok(!JSON.stringify(restored.data).includes('Additional provider-only final transcript context.'));
        assert.equal((await h.getView('')).status, 400);
        assert.ok([...h.db.keys()].every(key => key.startsWith(prefix)), 'James storage must remain isolated');
    });
});

test('optional public AgentMail preflight outage withholds email without blocking James launch, binding or note capture', async () => {
    await withPublicRoute({ preflightFails: true }, async h => {
        const start = await h.start(); assert.equal(start.state, 'LAUNCHING'); assert.equal(start.demo_email_authorized, false);
        assert.match(start.operation_notice, /Email is unavailable.*James and the legal pad remain available/);
        assert.equal(h.inboxReads(), 1); assert.equal(h.launches(), 1); assert.equal(h.stored().demoEmail, undefined);
        const bound = await h.action('bind', { providerId }); assert.equal(bound.state, 'ACTIVE');
        const noted = await h.turn('user', 'I was rear-ended.');
        assert.equal(noted.acceptedVisitorTurns, 1); assert.equal(noted.intakeBrief.hasSubstantiveFact, true);
        assert.equal((await h.postResult('preview-demo-email')).status, 400); assert.equal(h.sends.length, 0);
    });
});

test('public owner demo automatically sends three messages after verified close without review or send actions',async()=>{
    await withPublicRoute({},async h=>{
        const start=await h.start();assert.equal(start.demo_email_automatic,true);
        const closed=await h.closeComplete();assert.notEqual(closed.intakeBrief.phase,'CONFIRMED');
        assert.equal(h.sends.length,0,'transport runs after the response');
        await h.drain();assert.equal(h.sends.length,3);
        assert.ok(h.sends.every(m=>m.body.to.length===1&&m.body.to[0]===INTERNAL_DEMO_RECIPIENT));
        assert.equal(h.stored().demoEmail.consentSource,'OWNER_AUTOMATIC');
        assert.equal(h.stored().intakeBrief.confirmation,undefined,'no fabricated visitor confirmation');
        assert.ok(h.sends[0].body.attachments[0].content);
        await h.getView();await h.action('verify-ended');await h.drain();assert.equal(h.sends.length,3);
    });
});

test('provider-ended event sends even with incomplete notes and no caller email, without closing a live session',async()=>{
    await withPublicRoute({},async h=>{
        await h.start();await h.action('bind',{providerId});
        await h.turn('user','I was rear-ended in Phoenix.');
        h.ended();await h.action('verify-ended');await h.drain();
        assert.equal(h.stored().state,'CLOSED');assert.equal(h.sends.length,3);
        assert.ok(h.sends.every(m=>m.body.to[0]===INTERNAL_DEMO_RECIPIENT));
        assert.equal(h.stored().intakeBrief.confirmation,undefined);
    });
});

test('routing to caller never acquires an automatic owner capability',async()=>{
    await withPublicRoute({recipientMode:'caller'},async h=>{
        assert.equal((await h.start()).demo_email_automatic,false);
        await h.closeComplete();await h.drain();assert.equal(h.sends.length,0);
    });
});

test('End conversation releases provider and automatically delivers; repeated release is at most once',async()=>{
    await withPublicRoute({},async h=>{
        await h.start();await h.action('bind',{providerId});await h.turn('user','I need help with a collision.');
        const ended=await h.action('release-browser-session');assert.equal(ended.restartAllowed,true);
        await h.action('release-browser-session');
        await h.drain();assert.equal(h.sends.length,3);
        assert.equal(h.db.get(prefix+'demo-email-budget:total'),'1');
    });
});

test('unverified transcript records a visible failure and sends nothing',async()=>{
    await withPublicRoute({transcriptFails:true},async h=>{
        await h.start();await h.action('bind',{providerId});await h.turn('user','I need help.');h.ended();
        await h.action('verify-ended');await h.drain();
        assert.equal(h.sends.length,0);assert.match(h.stored().demoEmail.automaticError,/No delivery is confirmed/);
        assert.ok((await h.getView()).data.demo_email_error);
        await h.drain();assert.equal(h.sends.length,0);
    });
});

for (const options of [{ unset: ['JAMES_PUBLIC_DEMO_EMAIL_ENABLED'] }, { env: { JAMES_DEMO_EMAIL_BUNDLE: 'two' } }]) {
    test('public default stays mail-off despite hidden email flag: ' + JSON.stringify(options), async () => {
        await withPublicRoute(options, async h => {
            const start = await h.start(); assert.equal(start.demo_email_authorized, false);
            assert.equal(h.inboxReads(), 0); assert.equal(h.launches(), 1); assert.equal(h.stored().demoEmail, undefined);
            assert.equal((await h.postResult('demo-email-preflight')).status, 400);
            assert.equal((await h.postResult('preview-demo-email')).status, 400);
            assert.equal((await h.postResult('send-demo-email', { approved: true })).status, 400);
            assert.equal(h.sends.length, 0);
        });
    });
}
