import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { verifyAmyAnamLiveIdentity } from '../lib/anam/live-identity.ts';
import {
    buildAmyAnamMemoryAccessPolicy,
    buildAmyAnamReturningMemoryContext,
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

test('letter-by-letter voice spelling resolves to the saved compact email', () => {
    for (const email of ['r-v-i-c-k-s@gmail.com', 'r v i c k s @ gmail.com', 'r-v-i-c-k-s@g-m-a-i-l.com']) {
        const result = verifyAmyAnamLiveIdentity({
            preferredName: 'Rob',
            email,
            browserIdentity,
            approvedHistory,
            identitySalt,
        });
        assert.ok(result, `expected ${email} to match the saved identity`);
        assert.equal(result.normalizedEmail, 'rvicks@gmail.com');
    }
});

test('an explicitly saved hyphenated mailbox remains intact', () => {
    const hyphenatedIdentity = {
        ...browserIdentity,
        emailIdentityHash: deriveAmyAnamEmailIdentityHash('rob-vicks@gmail.com', identitySalt),
    };
    const result = verifyAmyAnamLiveIdentity({
        preferredName: 'Rob',
        email: 'rob-vicks@gmail.com',
        browserIdentity: hyphenatedIdentity,
        approvedHistory,
        identitySalt,
    });
    assert.ok(result);
    assert.equal(result.normalizedEmail, 'rob-vicks@gmail.com');
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

test('returning memory is revealed briefly as earlier-session context, never as a current-call echo', () => {
    const context = buildAmyAnamReturningMemoryContext(approvedHistory);
    assert.match(context, /approved notes from an earlier conversation/i);
    assert.match(context, /at most two or three distinctive prior facts/i);
    assert.match(context, /has not already supplied today/i);
    assert.match(context, /ask whether they are still current/i);
    assert.match(context, /never use today's statements as proof of memory/i);
    assert.match(context, /Do not say "memory unlocked,/i);
    assert.match(context, /action-capable tool explicitly returned a successful receipt/i);
    assert.match(context, /ERP migration/i);
    assert.doesNotMatch(context, /rvicks@gmail\.com|Website Alias/i);
});

test('server and client enforce delayed, session-owned memory unlock', async () => {
    const tokenRoute = await readFile(new URL('../app/api/anam-token/route.ts', import.meta.url), 'utf8');
    const identityRoute = await readFile(new URL('../app/api/anam/session/identity/route.ts', import.meta.url), 'utf8');
    const player = await readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
    const reliabilityPrompt = await readFile(new URL('../config/anam/amy-cara4-reliability-upgrade.md', import.meta.url), 'utf8');
    const identityTool = await readFile(new URL('../config/anam/amy-live-identity-client-tool.json', import.meta.url), 'utf8');

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
    assert.match(player, /two or three distinctive earlier-session facts/);
    assert.match(player, /result\.memoryCount > 0/);
    assert.doesNotMatch(player, /console\.(?:log|info|error)[^\n]*(?:normalizedEmail|confirmedContact)/);
    assert.match(reliabilityPrompt, /never present current-call statements as proof of memory/i);
    assert.match(reliabilityPrompt, /action-capable tool explicitly reports success/i);
    assert.match(reliabilityPrompt, /Treat "that's all," "nothing else," "wrap up," "goodbye,"/i);
    assert.match(reliabilityPrompt, /Do not ask "anything else"/i);
    assert.match(reliabilityPrompt, /slightly unhurried cadence/i);
    assert.match(reliabilityPrompt, /letter by letter/i);
    assert.match(reliabilityPrompt, /Preserve any hyphen or punctuation/i);
    assert.match(identityTool, /compact canonical form/i);
    assert.match(identityTool, /preserve punctuation explicitly stated/i);
});
