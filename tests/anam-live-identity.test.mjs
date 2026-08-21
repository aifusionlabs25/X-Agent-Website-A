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

test('session-bound check-in identity unlocks memory after explicit permission', () => {
    const result = verifyAmyAnamLiveIdentity({
        preferredName: ' Rob ',
        memoryAccessConfirmed: true,
        browserIdentity,
        approvedHistory,
    });
    assert.ok(result);
    assert.equal(result.preferredName, 'Rob');
    assert.equal(result.memoryCount, 1);
    assert.match(result.memoryContext, /ERP migration/i);
    assert.doesNotMatch(result.memoryContext, /rvicks@gmail\.com|Website Alias/i);
    assert.doesNotMatch(JSON.stringify(result), /normalizedEmail|emailIdentityHash/i);
});

test('memory remains locked without live permission or a consented check-in identity', () => {
    assert.equal(verifyAmyAnamLiveIdentity({
        preferredName: 'Rob',
        memoryAccessConfirmed: false,
        browserIdentity,
        approvedHistory,
    }), null);
    assert.equal(verifyAmyAnamLiveIdentity({
        preferredName: 'Rob',
        memoryAccessConfirmed: true,
        browserIdentity: { ...browserIdentity, memoryConsent: false, emailIdentityHash: null },
        approvedHistory,
    }), null);
    assert.equal(verifyAmyAnamLiveIdentity({
        preferredName: 'Rob',
        memoryAccessConfirmed: true,
        browserIdentity: { ...browserIdentity, emailIdentityHash: null },
        approvedHistory,
    }), null);
    assert.throws(() => verifyAmyAnamLiveIdentity({
        preferredName: '',
        memoryAccessConfirmed: true,
        browserIdentity,
        approvedHistory,
    }), /preferred name/i);
});

test('pre-unlock policy warms up and asks permission without requesting spoken email', () => {
    const policy = buildAmyAnamMemoryAccessPolicy(true);
    assert.match(policy, /configured warm greeting/i);
    assert.match(policy, /do not.*repeat the name question.*clear real name/i);
    assert.match(policy, /at least one useful conversational exchange/i);
    assert.match(policy, /check for notes from an earlier conversation/i);
    assert.match(policy, /memoryAccessConfirmed set to true/i);
    assert.match(policy, /Use the clear real name the visitor already gave/i);
    assert.match(policy, /Ask what name to use only if that answer was missing or unclear/i);
    assert.doesNotMatch(policy, /What name would you like me to use\?/i);
    assert.match(policy, /Never ask for, spell, or repeat an email address solely to unlock memory/i);
    assert.doesNotMatch(policy, /rvicks|Website Alias|ERP migration/i);
});

test('returning memory is revealed briefly as earlier-session context, never as a current-call echo', () => {
    const context = buildAmyAnamReturningMemoryContext(approvedHistory);
    assert.match(context, /approved notes from an earlier conversation/i);
    assert.match(context, /private website check-in identity/i);
    assert.match(context, /not conversational data/i);
    assert.match(context, /at most two or three distinctive prior facts/i);
    assert.match(context, /has not already supplied today/i);
    assert.match(context, /ask whether they are still current/i);
    assert.match(context, /never use today's statements as proof of memory/i);
    assert.match(context, /Do not say "memory unlocked,/i);
    assert.match(context, /action-capable tool explicitly returned a successful receipt/i);
    assert.match(context, /ERP migration/i);
    assert.doesNotMatch(context, /rvicks@gmail\.com|Website Alias/i);
});

test('server and client enforce delayed, session-owned, email-free memory unlock', async () => {
    const tokenRoute = await readFile(new URL('../app/api/anam-token/route.ts', import.meta.url), 'utf8');
    const identityRoute = await readFile(new URL('../app/api/anam/session/identity/route.ts', import.meta.url), 'utf8');
    const sessionClient = await readFile(new URL('../lib/anam/session-spine-client.ts', import.meta.url), 'utf8');
    const verifier = await readFile(new URL('../lib/anam/live-identity.ts', import.meta.url), 'utf8');
    const player = await readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
    const reliabilityPrompt = await readFile(new URL('../config/anam/amy-cara4-reliability-upgrade.md', import.meta.url), 'utf8');
    const deprecatedUpdater = await readFile(new URL('../scripts/anam/update-amy-cara4-reliability.mjs', import.meta.url), 'utf8');
    const identityToolRaw = await readFile(new URL('../config/anam/amy-live-identity-client-tool.json', import.meta.url), 'utf8');
    const identityTool = JSON.parse(identityToolRaw);

    assert.doesNotMatch(tokenRoute, /readAmyAnamApprovedMemoryHistory|buildAmyAnamReturningMemoryContext/);
    assert.match(tokenRoute, /buildAmyAnamMemoryAccessPolicy/);
    assert.match(identityRoute, /launch\.browserSessionId === browserSession\.id/);
    assert.match(identityRoute, /launch\.boundSessionId === sessionId/);
    assert.match(identityRoute, /session\.launchId === launchId/);
    assert.match(identityRoute, /launchAgentSlug === 'amy'/);
    assert.match(identityRoute, /sessionAgentSlug === 'amy'/);
    assert.match(identityRoute, /launchVariant === AMY_CARA4_VARIANT/);
    assert.match(identityRoute, /sessionVariant === AMY_CARA4_VARIANT/);
    assert.match(identityRoute, /launch\.resolvedPersonaId === session\.resolvedPersonaId/);
    assert.match(identityRoute, /memoryAccessConfirmed = body\.memoryAccessConfirmed/);
    assert.doesNotMatch(identityRoute, /body\.email|normalizedEmail/);
    assert.doesNotMatch(verifier, /deriveAmyAnamEmailIdentityHash|normalizeAmyAnamMemoryEmail|normalizedEmail/);
    assert.match(player, /completedUserTurns < 2/);
    assert.match(player, /registerToolCallHandler\(\s*'confirm_live_identity'/s);
    assert.ok(
        player.indexOf("registerToolCallHandler(\n                        'confirm_live_identity'")
            < player.indexOf("streamToVideoElement('persona-video')"),
    );
    assert.match(player, /payload\.arguments\.memoryAccessConfirmed === true/);
    assert.match(player, /if \(!preferredName \|\| \/\^\(\?:user\|visitor\|guest\|customer\)\$\/i\.test\(preferredName\)\)/);
    assert.match(player, /if \(!memoryAccessConfirmed\)/);
    assert.match(player, /Do not ask for the name again/);
    assert.match(player, /confirmedMemoryName = result\.preferredName/);
    assert.doesNotMatch(player, /payload\.arguments\.email|normalizedEmail|confirmedContact/);
    assert.match(sessionClient, /JSON\.stringify\(\{ launchId, sessionId, preferredName, memoryAccessConfirmed \}\)/);
    assert.doesNotMatch(sessionClient, /preferredName, email/);
    assert.match(player, /two or three distinctive earlier-session facts/);
    assert.match(player, /result\.memoryCount > 0/);
    assert.match(reliabilityPrompt, /Never ask for, spell, repeat, or submit an email address to unlock memory/i);
    assert.match(reliabilityPrompt, /do not ask for the name a second time/i);
    assert.match(identityTool.description, /do not ask for it again/i);
    assert.match(identityTool.config.parameters.properties.preferredName.description, /in response to Amy's greeting/i);
    assert.match(reliabilityPrompt, /contact collection as a separate action/i);
    assert.match(reliabilityPrompt, /never present current-call statements as proof of memory/i);
    assert.match(reliabilityPrompt, /action-capable tool explicitly reports success/i);
    assert.match(reliabilityPrompt, /Never propose ending the call merely because an answer, summary, or Workbench display is complete/i);
    assert.match(reliabilityPrompt, /"Thanks," "okay," "sounds good," "got it,"/i);
    assert.match(reliabilityPrompt, /Call `end_amy_session` silently with exactly an empty object, before speaking, and at most once/i);
    assert.match(reliabilityPrompt, /Do not ask for confirmation/i);
    assert.match(reliabilityPrompt, /When a hard close returns `farewell_required`/i);
    assert.match(reliabilityPrompt, /Leave a brief natural beat after the visitor stops speaking/i);
    assert.match(reliabilityPrompt, /Treat "hang on," "give me a moment," "let me review,"/i);
    assert.match(reliabilityPrompt, /preserve it as an open item/i);
    assert.match(reliabilityPrompt, /Do not use "Is there anything else\?" as routine filler/i);
    assert.match(reliabilityPrompt, /Never speak the word "goodbye" before the successful `end_amy_session` receipt/i);
    assert.match(reliabilityPrompt, /Never write, say, or expose XML-like, JSON-like, bracketed, or angle-bracket tool syntax/i);
    assert.match(reliabilityPrompt, /call skip_turn and remain silent/i);
    assert.match(reliabilityPrompt, /Never use "before we wrap up/i);
    assert.match(player, /voiceDetection: \{ endOfSpeechSensitivity: 0\.05 \}/);
    assert.match(deprecatedUpdater, /Deprecated unsafe Amy updater/);
    assert.match(deprecatedUpdater, /anam:update-amy-workbench/);
    assert.doesNotMatch(deprecatedUpdater, /fetch\(|method:\s*['"](?:PUT|POST)['"]/);
    assert.match(reliabilityPrompt, /say exactly one calm farewell: "Thanks for talking this through with me\. Take care\."/i);
    assert.deepEqual(identityTool.config.parameters.required, ['preferredName', 'memoryAccessConfirmed']);
    assert.equal(identityTool.config.parameters.properties.memoryAccessConfirmed.type, 'boolean');
    assert.equal(identityTool.config.parameters.properties.email, undefined);
});

