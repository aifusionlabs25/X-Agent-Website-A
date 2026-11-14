import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {
    createEvanDemoGrant, EVAN_DEMO_COOKIE, EVAN_EXTENDED_DEMO_SECONDS,
    hasEvanDemoGrant, resolveEvanDemoPolicy,
} from '../lib/anam/evan-demo-policy.ts';
import { EVAN_PERSONA_ID } from '../lib/anam/persona-ids.ts';

const origin = 'https://evan-meeting-preview.example';
const extendedId = '22222222-2222-4222-8222-222222222222';
const secret = 'fictional-meeting-demo-access-secret-over-32-characters';
const source = readFileSync(new URL('../app/api/anam/evan/meetings/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(options = {}) {
    const env = {
        EVAN_EXTENDED_DEMO_ACCESS_KEY: secret,
        EVAN_EXTENDED_DEMO_PERSONA_ID: extendedId,
        EVAN_PUBLIC_DEMO_PERSONA_ID: '11111111-1111-4111-8111-111111111111',
        ...options.env,
    };
    let adapter;
    const snapshotCalls = [];
    const mocks = {
        '@/lib/anam/persona-ids': { EVAN_PERSONA_ID },
        '@/lib/anam/evan-demo-policy': {
            EVAN_EXTENDED_DEMO_SECONDS,
            hasEvanDemoGrant: request => hasEvanDemoGrant(request, env),
            resolveEvanDemoPolicy: (request, _runtimeEnv, mode) => resolveEvanDemoPolicy(request, env, mode),
        },
        '@/lib/anam/session-spine': {
            readAmyAnamSpineConfig: () => ({ gatesOpen: options.gatesOpen !== false, signingSecret: 'offline-spine-secret' }),
            readAmyAnamBrowserSession: request => request.headers.get('cookie')?.split('; ').includes('test-check-in=valid')
                ? { id: 'offline-browser-id' } : null,
            isTrustedBrowserOrigin: () => true,
            readBoundedJsonObject: async () => { throw new Error('No route transport expected'); },
            requestFingerprint: () => 'offline-fingerprint',
        },
        '@/lib/anam/contact-token': {
            readAmyAnamContactFromRequest: () => options.contact === null ? null : {
                purpose: 'evan_follow_up', displayName: 'Fictional Visitor', ...options.contact,
            },
        },
        '@/lib/anam/session-spine-store': {
            consumeAmyAnamDistributedRateLimit: async () => { throw new Error('No Redis call expected'); },
        },
        '@/lib/meeting-concierge/v1/server': {
            createMeetingConciergeHandlers: candidate => {
                adapter = candidate;
                return { GET() {}, POST() {}, DELETE() {} };
            },
        },
        '@/lib/meeting-concierge/v1/persona-snapshot': {
            resolveMeetingPersonaSnapshot: async input => {
                snapshotCalls.push(JSON.parse(JSON.stringify(input)));
                return { type: 'ephemeral', maxSessionLengthSeconds: input.maxSessionLengthSeconds };
            },
        },
    };
    const context = vm.createContext({
        process: { env },
        fetch: async () => { throw new Error('Network prohibited in offline meeting test'); },
    });
    const execute = vm.runInContext(`(function(require, module, exports) { ${compiled}\n})`, context);
    const module = { exports: {} };
    execute(specifier => {
        assert.ok(Object.hasOwn(mocks, specifier), `unmocked import ${specifier}`);
        return mocks[specifier];
    }, module, module.exports);
    function request({ checkIn = true, grant = false, token, targetOrigin = origin } = {}) {
        const cookies = [
            ...(checkIn ? ['test-check-in=valid'] : []),
            ...(grant || token ? [`${EVAN_DEMO_COOKIE}=${token ?? createEvanDemoGrant(origin, env)}`] : []),
        ];
        return new Request(`${targetOrigin}/api/anam/evan/meetings`, { headers: { cookie: cookies.join('; ') } });
    }
    return { adapter, env, snapshotCalls, request };
}

test('ordinary public email check-in alone cannot organize a longer Evan meeting', async () => {
    const h = harness();
    assert.equal(await h.adapter.readOrganizer(h.request()), null);
    assert.deepEqual(h.snapshotCalls, []);
});

test('a valid private grant and existing email check-in authorize the isolated organizer', async () => {
    const h = harness();
    const organizer = await h.adapter.readOrganizer(h.request({ grant: true }));
    assert.deepEqual(JSON.parse(JSON.stringify(organizer)), {
        authenticated: true, displayName: 'Fictional Visitor', isolationId: 'offline-browser-id',
    });
    assert.deepEqual(h.snapshotCalls, [], 'authorization alone must not create a paid meeting');
});

test('private grant does not bypass browser ownership or Evan contact requirements', async () => {
    const h = harness();
    assert.equal(await h.adapter.readOrganizer(h.request({ checkIn: false, grant: true })), null);
    for (const options of [{ contact: null }, { contact: { purpose: 'amy_follow_up' } }, { contact: { displayName: '' } }, { gatesOpen: false }]) {
        const candidate = harness(options);
        assert.equal(await candidate.adapter.readOrganizer(candidate.request({ grant: true })), null);
        assert.deepEqual(candidate.snapshotCalls, []);
    }
});

test('expired, tampered, and cross-origin private grants cannot create meeting organizers', async () => {
    const h = harness();
    const token = createEvanDemoGrant(origin, h.env);
    const expired = createEvanDemoGrant(origin, h.env, Date.now() - 3_700_000);
    for (const input of [{ token: `${token}x` }, { token: expired }, { token, targetOrigin: 'https://other-preview.example' }]) {
        assert.equal(await h.adapter.readOrganizer(h.request(input)), null);
    }
    assert.deepEqual(h.snapshotCalls, []);
});

test('missing or malformed extended configuration fails closed despite a signed grant', async () => {
    for (const configuration of ['', 'malformed-id', undefined]) {
        const h = harness({ env: { EVAN_EXTENDED_DEMO_PERSONA_ID: configuration } });
        assert.equal(await h.adapter.readOrganizer(h.request({ grant: true })), null);
        assert.deepEqual(h.snapshotCalls, []);
    }
    const h = harness();
    const request = h.request({ grant: true });
    h.env.EVAN_EXTENDED_DEMO_ACCESS_KEY = '';
    assert.equal(await h.adapter.readOrganizer(request), null);
});

test('protected meeting validation remains private and does not depend on public persona configuration', async () => {
    const h = harness({ env: { EVAN_PUBLIC_DEMO_PERSONA_ID: '' } });
    const organizer = await h.adapter.readOrganizer(h.request({ grant: true }));
    assert.equal(organizer?.authenticated, true);
    assert.deepEqual(h.snapshotCalls, [], 'organizer validation must not start the meeting');
});

test('60-minute request is clamped to30 and snapshots only the isolated private copy', async () => {
    const h = harness();
    const result = await h.adapter.resolvePersona({ apiKey: 'offline-key', maxSessionLengthSeconds: 3600 });
    assert.equal(result.personaConfig.maxSessionLengthSeconds, 1800);
    assert.equal(h.snapshotCalls.length, 1);
    assert.equal(h.snapshotCalls[0].expectedPersonaId, extendedId);
    assert.notEqual(h.snapshotCalls[0].expectedPersonaId, EVAN_PERSONA_ID);
    assert.equal(h.snapshotCalls[0].maxSessionLengthSeconds, 1800);
    assert.deepEqual(h.snapshotCalls[0].removeToolNames, ['end_mullins_session', 'send_mullins_follow_up_email', 'show_move_planner']);
    assert.deepEqual(h.snapshotCalls[0].addToolNames, ['end_call']);
});

test('shorter approved meeting duration is preserved rather than extended to30 minutes', async () => {
    const h = harness();
    await h.adapter.resolvePersona({ apiKey: 'offline-key', maxSessionLengthSeconds: 900 });
    assert.equal(h.snapshotCalls[0].maxSessionLengthSeconds, 900);
    assert.equal(h.snapshotCalls[0].expectedPersonaId, extendedId);
});
