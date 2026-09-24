import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspectJamesReleasePolicy } from '../lib/anam/james-release-policy.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'config', 'anam', 'james', 'v2');
const prompt = await fs.readFile(path.join(releaseDir, 'system-prompt.md'), 'utf8');
const knowledgeManifest = JSON.parse(await fs.readFile(path.join(releaseDir, 'knowledge-manifest.json'), 'utf8'));
const runtimeManifest = JSON.parse(await fs.readFile(path.join(releaseDir, 'runtime-release-manifest.json'), 'utf8'));
const transcriptRoute = await fs.readFile(path.join(root, 'app', 'api', 'save-transcript', 'route.ts'), 'utf8');
const tokenRoute = await fs.readFile(path.join(root, 'app', 'api', 'anam-token', 'route.ts'), 'utf8');
const readinessRoute = await fs.readFile(path.join(root, 'app', 'api', 'anam', 'james', 'readiness', 'route.ts'), 'utf8');
const releaseGateComponent = await fs.readFile(path.join(root, 'components', 'james', 'JamesPrivacyReleaseGate.tsx'), 'utf8');
const createCandidateScript = await fs.readFile(path.join(root, 'scripts', 'anam', 'create-james-v2-candidate.mjs'), 'utf8');
const auditCandidateScript = await fs.readFile(path.join(root, 'scripts', 'anam', 'audit-james-v2-candidate.mjs'), 'utf8');

const sha256 = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const normalizePrompt = value => `${value.replace(/\r\n/g, '\n').trim()}\n`;

test('James v2 prompt discloses AI and session limits without promising legal action', () => {
    assert.ok(prompt.includes('<!-- JAMES_CANONICAL_SP_START -->'));
    assert.ok(prompt.includes('<!-- JAMES_CANONICAL_SP_END -->'));
    assert.ok(prompt.includes('JAMES_ANAM_SP_2026_09_23'));
    assert.match(prompt, /AI intake assistant/i);
    assert.match(prompt, /not (?:a )?confidential or privileged/i);
    assert.match(prompt, /may record or transcribe/i);
    assert.match(prompt, /Do not solicit or collect a visitor's full name, phone number, email/i);
    assert.match(prompt, /602-702-5431/);
    assert.doesNotMatch(prompt, /I(?:'|’)ll make sure an attorney reviews|attorney will review|schedule a consultation|I am not an AI/i);
});

test('James v2 knowledge bundle is a fingerprinted, James-only allowlist', async () => {
    assert.equal(knowledgeManifest.deploymentStatus, 'draft_not_live');
    assert.equal(knowledgeManifest.persona.sourceId, '8a991c93-0c95-42c5-8c22-a67428946eb8');
    assert.equal(knowledgeManifest.persona.managedCanaryId, '1663b021-60fb-4782-be63-8ed366dea747');
    assert.equal(knowledgeManifest.liveGroupId, 'eae271e8-9d73-4cfd-8a46-6463f893aed3');
    assert.equal(knowledgeManifest.liveToolId, '5796aee6-6963-4b0e-a378-28517a631461');
    assert.equal(knowledgeManifest.liveDocuments.length, 6);
    assert.ok(knowledgeManifest.liveDocuments.every(document => document.status === 'READY'));
    assert.equal(knowledgeManifest.documents.length, 6);
    assert.deepEqual(Object.keys(knowledgeManifest.documentFingerprints).sort(), [...knowledgeManifest.documents].sort());

    const bundleInput = JSON.stringify({
        bundleVersion: knowledgeManifest.bundleVersion,
        documents: knowledgeManifest.documents.map(filename => ({
            filename,
            ...knowledgeManifest.documentFingerprints[filename],
        })),
    });
    assert.equal(knowledgeManifest.bundleSha256, sha256(bundleInput));

    for (const filename of knowledgeManifest.documents) {
        const source = await fs.readFile(path.join(releaseDir, 'knowledge', filename), 'utf8');
        const content = Buffer.from(source.replace(/\r\n?/g, '\n'), 'utf8');
        const fingerprint = knowledgeManifest.documentFingerprints[filename];
        assert.equal(fingerprint.bytes, content.byteLength, `${filename} canonical byte length`);
        assert.equal(fingerprint.sha256, sha256(content), `${filename} canonical SHA-256`);
        assert.doesNotMatch(content.toString('utf8'), /pretend to be human|claim attorney review|Calendly|"not an AI"/i, `${filename} must not inherit legacy Tavus behavior`);
    }
});

test('runtime candidate remains unavailable until privacy approval and all release checks pass', () => {
    assert.equal(runtimeManifest.deploymentStatus, 'draft_not_live');
    assert.equal(runtimeManifest.managedPersona.id, '1663b021-60fb-4782-be63-8ed366dea747');
    assert.equal(runtimeManifest.prompt.sha256, sha256(normalizePrompt(prompt)));
    assert.equal(runtimeManifest.knowledge.documentsReady, true);
    assert.deepEqual(runtimeManifest.knowledge.documentFolderIds, ['eae271e8-9d73-4cfd-8a46-6463f893aed3']);
    assert.equal(runtimeManifest.managedPersona.zeroDataRetention, false);
    assert.equal(runtimeManifest.privacyGate.status, 'blocked');
    assert.equal(runtimeManifest.privacyGate.retainedTranscriptApproval.status, 'pending');
    assert.equal(runtimeManifest.liveVerification.status, 'candidate_readback_passed');
    assert.equal(runtimeManifest.liveVerification.smokeTestsPassed, false);
    assert.equal(inspectJamesReleasePolicy(runtimeManifest).ready, false);
});

test('James transcript suppression precedes storage, analysis, Sheets, and email', () => {
    const suppression = transcriptRoute.indexOf('if (isJamesPersona)');
    assert.ok(suppression > 0);
    for (const sideEffect of [
        "path.join(process.cwd(), 'transcripts')",
        'analyzeTranscript(',
        'appendLead(',
        'new Resend(',
    ]) {
        assert.ok(transcriptRoute.indexOf(sideEffect) > suppression, `${sideEffect} must be after the James suppression`);
    }
    assert.match(transcriptRoute.slice(suppression, transcriptRoute.indexOf('if (variant', suppression)), /privacySuppressed: true/);
    assert.match(transcriptRoute.slice(suppression, transcriptRoute.indexOf('if (variant', suppression)), /outbound: false/);
    assert.match(transcriptRoute, /managedPersona\.id === 'string'[\s\S]*personaId === jamesRuntimeReleaseManifest\.managedPersona\.id/);
});

test('James production launch stays closed until publication, live checks, and one approved privacy path pass', () => {
    const readyManifest = structuredClone(runtimeManifest);
    readyManifest.deploymentStatus = 'published';
    readyManifest.managedPersona.id = '90000000-0000-4000-8000-000000000001';
    readyManifest.managedPersona.zeroDataRetention = false;
    readyManifest.privacyGate.status = 'approved';
    readyManifest.requiredTools = readyManifest.requiredTools.map((tool, index) => ({
        ...tool,
        id: `90000000-0000-4000-8000-${String(index + 2).padStart(12, '0')}`,
    }));
    readyManifest.knowledge.documentFolderIds = ['90000000-0000-4000-8000-000000000005'];
    readyManifest.knowledge.documentsReady = true;
    readyManifest.privacyGate.retainedTranscriptApproval = {
        status: 'approved',
        approvedBy: 'privacy-review-owner',
        approvedAt: '2026-09-23T12:00:00.000Z',
        evidenceReference: 'approved-retention-review-2026-09',
        scopeConfirmed: true,
    };
    readyManifest.liveVerification = {
        status: 'verified',
        verifiedAt: '2026-09-23T12:10:00.000Z',
        personaReadbackSha256: 'a'.repeat(64),
        knowledgeToolReadbackId: readyManifest.requiredTools[0].id,
        knowledgeGroupReadbackId: readyManifest.knowledge.documentFolderIds[0],
        allDocumentsReady: true,
        toolAttachmentsMatch: true,
        promptHashMatches: true,
        smokeTestsPassed: true,
        sourcePersonaUnchanged: true,
        priorCanaryUnchanged: true,
    };

    assert.equal(inspectJamesReleasePolicy(readyManifest).ready, true);
    assert.equal(inspectJamesReleasePolicy(readyManifest).privacyMode, 'documented_retained_transcript_approval');

    const zdrManifest = structuredClone(readyManifest);
    zdrManifest.managedPersona.zeroDataRetention = true;
    zdrManifest.privacyGate.retainedTranscriptApproval.status = 'pending';
    zdrManifest.privacyGate.retainedTranscriptApproval.scopeConfirmed = false;
    zdrManifest.privacyGate.providerZeroDataRetention = {
        verified: true,
        verifiedAt: '2026-09-23T12:05:00.000Z',
        evidenceReference: 'provider-readback-2026-09',
    };
    assert.equal(inspectJamesReleasePolicy(zdrManifest).ready, true);
    assert.equal(inspectJamesReleasePolicy(zdrManifest).privacyMode, 'provider_zero_data_retention');

    readyManifest.privacyGate.retainedTranscriptApproval.scopeConfirmed = false;
    readyManifest.privacyGate.status = 'blocked';
    assert.equal(inspectJamesReleasePolicy(readyManifest).ready, false);
    assert.match(readinessRoute, /inspectJamesReleasePolicy/);
    assert.match(tokenRoute, /jamesReleasePolicy\?\.ready/);
    assert.match(tokenRoute, /personaId: tokenPersonaId/);
    assert.match(releaseGateComponent, /api\/anam\/james\/readiness/);
    assert.match(releaseGateComponent, /James is temporarily unavailable/);
});

test('Anam candidate workflow only creates isolated resources and has a GET-only verification pass', () => {
    assert.match(createCandidateScript, /const SOURCE_PERSONA_ID = '8a991c93-0c95-42c5-8c22-a67428946eb8'/);
    assert.match(createCandidateScript, /const PRIOR_CANARY_ID = 'ff9c480e-44d1-4a8c-8ae6-b5666fd2a92d'/);
    assert.match(createCandidateScript, /zeroDataRetention: false/);
    assert.match(createCandidateScript, /productionActivation: 'not performed'/);
    assert.match(createCandidateScript, /Pass --apply to create only new, versioned Anam resources/);
    assert.doesNotMatch(createCandidateScript, /method:\s*['"](?:PUT|DELETE)['"]/i);
    assert.doesNotMatch(createCandidateScript, /\/share-links/);
    assert.match(auditCandidateScript, /method: 'GET'/);
    assert.doesNotMatch(auditCandidateScript, /method:\s*['"](?:POST|PUT|DELETE)['"]/i);
});
