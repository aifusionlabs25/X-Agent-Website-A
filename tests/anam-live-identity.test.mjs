import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { verifyAmyAnamLiveIdentity } from '../lib/anam/live-identity.ts';
import {
    buildAmyAnamMemoryAccessPolicy,
    deriveAmyAnamEmailIdentityHash,
} from '../lib/anam/user-memory.ts';

const identitySalt = 'fixture-identity-salt-that-is-at-least-32-characters';
const browserIdentity = {
    schemaVersion: 'amy_anam_browser_identity_v1',
    browserSessionId: 'browser-live-identity',
    displayName: 'Website Alias',
    emailIdentityHash: deriveAmyAnamEmailIdentityHash('rvicks@gmail.com', identitySalt),
    memoryConsent: true,
    createdAt: '2030-01-01T00:00:00.000Z',
};
const approvedHistory = [{
    schemaVersion: 'amy_anam_approved_memory_v1',
    memoryId: 'memory-1',
    externalSessionId: 'session-1',
    createdAt: '2030-01-01T00:00:00.000Z',
    summary: 'The visitor is planning an ERP migration from on-premises systems to Azure.',
    inquiryType: 'Cloud migration',
    recommendedNextSteps: ['Validate the overnight maintenance window'],
}];

test('live identity unlocks approved memory only for the matching confirmed email', () => {
    const result = verifyAmyAnamLiveIdentity({
        preferredName: ' Rob ',
        email: ' RVICKS@GMAIL.COM ',
        browserIdentity,
        approvedHistory,
        identitySalt,
    });
    assert.ok(result);
    assert.equal(result.preferredName, 'Rob');
    assert.equal(result.normalizedEmail, 'rvicks@gmail.com');
    assert.equal(result.memoryCount, 1);
    assert.match(result.memoryContext, /ERP migration/i);
    assert.doesNotMatch(result.memoryContext, /rvicks@gmail\.com|Website Alias/i);
});

test('a corrupted or unconsented email cannot unlock any approved history', () => {
    assert.equal(verifyAmyAnamLiveIdentity({
        preferredName: 'Rob',
        email: 'rvicksks@gmail.com',
        browserIdentity,
        approvedHistory,
        identitySalt,
    }), null);
    assert.equal(verifyAmyAnamLiveIdentity({
        preferredName: 'Rob',
        email: 'rvicks@gmail.com',
        browserIdentity: { ...browserIdentity, memoryConsent: false, emailIdentityHash: null },
        approvedHistory,
        identitySalt,
    }), null);
});

test('pre-unlock policy warms up first and reveals neither identity nor memory', () => {
    const policy = buildAmyAnamMemoryAccessPolicy(true);
    assert.match(policy, /warm, neutral greeting/i);
    assert.match(policy, /Do not ask.*opening turn/i);
    assert.match(policy, /at least one useful conversational exchange/i);
    assert.match(policy, /explicit confirmation/i);
    assert.doesNotMatch(policy, /rvicks|Website Alias|ERP migration/i);
});

test('server and client enforce delayed, session-owned memory unlock', async () => {
    const tokenRoute = await readFile(new URL('../app/api/anam-token/route.ts', import.meta.url), 'utf8');
    const identityRoute = await readFile(new URL('../app/api/anam/session/identity/route.ts', import.meta.url), 'utf8');
    const player = await readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');

    assert.doesNotMatch(tokenRoute, /readAmyAnamApprovedMemoryHistory|buildAmyAnamReturningMemoryContext/);
    assert.match(tokenRoute, /buildAmyAnamMemoryAccessPolicy/);
    assert.match(identityRoute, /launch\.browserSessionId === browserSession\.id/);
    assert.match(identityRoute, /launch\.boundSessionId === sessionId/);
    assert.match(identityRoute, /session\.launchId === launchId/);
    assert.match(identityRoute, /verifyAmyAnamLiveIdentity/);
    assert.match(player, /completedUserTurns < 2/);
    assert.match(player, /registerToolCallHandler\(\s*'confirm_live_identity'/s);
    assert.ok(
        player.indexOf("registerToolCallHandler(\n                        'confirm_live_identity'")
            < player.indexOf("streamToVideoElement('persona-video')"),
    );
    assert.match(player, /confirmedContact = \{ preferredName: result\.preferredName, email: normalizedEmail \}/);
    assert.doesNotMatch(player, /console\.(?:log|info|error)[^\n]*(?:normalizedEmail|confirmedContact)/);
});
