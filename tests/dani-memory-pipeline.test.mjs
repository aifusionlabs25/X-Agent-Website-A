import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    buildDaniAnamMemoryReviewCandidate,
} from '../lib/anam/dani-memory-candidate.ts';
import {
    prepareDaniAnamMemoryReviewCandidate,
} from '../lib/anam/dani-memory-candidate-finalizer.ts';
import {
    decideStoredDaniAnamMemoryCandidate,
} from '../lib/anam/dani-memory-review-decision.ts';
import {
    createDaniAnamMemoryCandidateEligibility,
} from '../lib/anam/dani-user-memory.ts';
import { DANI_PERSONA_ID } from '../lib/anam/persona-ids.ts';
import {
    buildAmyAnamReceipt,
    DANI_AI_SOLUTIONS_VARIANT,
} from '../lib/anam/session-spine.ts';
import {
    readDaniAnamMemoryReviewCandidate,
    writeAmyAnamReceipt,
} from '../lib/anam/session-spine-store.ts';

const NOW = Date.parse('2026-08-09T21:00:00.000Z');
const EXTERNAL_SESSION_ID = 'dani-session-12345678';
const turns = [
    { role: 'agent', content: 'What business problem should we explore?' },
    { role: 'user', content: 'Project Marigold needs a private workflow automation pilot. Contact me at private@example.com.' },
    { role: 'agent', content: 'Let us define the outcome and review boundary.' },
];

const session = {
    schemaVersion: 'amy_anam_session_v1',
    browserSessionId: 'dani-browser-12345678',
    launchId: 'dani-launch-123456789',
    externalSessionId: EXTERNAL_SESSION_ID,
    clientLabel: 'website-dani',
    resolvedPersonaId: DANI_PERSONA_ID,
    provider: 'anam',
    agentSlug: 'dani',
    variant: DANI_AI_SOLUTIONS_VARIANT,
    state: 'awaiting_transcript',
    createdAt: '2026-08-09T20:55:00.000Z',
    boundAt: '2026-08-09T20:55:01.000Z',
    closeReceivedAt: '2026-08-09T20:59:00.000Z',
};

const finalization = {
    schemaVersion: 'amy_anam_finalization_v1',
    browserSessionId: session.browserSessionId,
    launchId: session.launchId,
    externalSessionId: EXTERNAL_SESSION_ID,
    state: 'awaiting_transcript',
    closeReason: 'user_requested',
    receivedAt: '2026-08-09T20:59:00.000Z',
    updatedAt: '2026-08-09T20:59:30.000Z',
    attempts: 1,
    nextAttemptAt: '2026-08-09T21:00:00.000Z',
};

const receipt = buildAmyAnamReceipt({
    externalSessionId: EXTERNAL_SESSION_ID,
    closeReason: 'user_requested',
    source: 'anam_api',
    turns,
    variant: DANI_AI_SOLUTIONS_VARIANT,
    now: NOW,
});

const identity = {
    schemaVersion: 'dani_anam_session_memory_identity_v1',
    agent: 'dani',
    personaId: DANI_PERSONA_ID,
    externalSessionId: EXTERNAL_SESSION_ID,
    browserSessionId: session.browserSessionId,
    emailIdentityHash: 'e'.repeat(64),
    memoryConsent: true,
    consentEpoch: 'consent-epoch-12345678',
    linkedAt: '2026-08-09T20:56:00.000Z',
};

const spineEnv = {
    AMY_ANAM_SESSION_SPINE_ENABLED: 'true',
    AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
    AMY_ANAM_SESSION_SECRET: 's'.repeat(32),
    AMY_ANAM_REDIS_REST_URL: 'https://spine-redis.example.invalid',
    AMY_ANAM_REDIS_REST_TOKEN: 'spine-redis-token',
};

function artifact() {
    return buildDaniAnamMemoryReviewCandidate({ session, receipt, turns });
}

function redisResponse(results) {
    return new Response(JSON.stringify(results.map(result => ({ result }))), { status: 200 });
}

test('finalizer preparation requires exact Dani provenance and an active linked identity', async () => {
    let identityReads = 0;
    const prepared = await prepareDaniAnamMemoryReviewCandidate({ session, receipt, turns }, {
        readIdentity: async externalSessionId => {
            identityReads += 1;
            assert.equal(externalSessionId, EXTERNAL_SESSION_ID);
            return identity;
        },
    });
    assert.equal(identityReads, 1);
    assert.equal(prepared.artifact.externalSessionId, EXTERNAL_SESSION_ID);
    assert.equal(prepared.artifact.automaticApproval, false);
    assert.deepEqual(prepared.eligibility, createDaniAnamMemoryCandidateEligibility(identity));

    assert.equal(await prepareDaniAnamMemoryReviewCandidate({ session, receipt, turns }, {
        readIdentity: async () => null,
    }), undefined, 'no consent-linked identity must produce no candidate');

    identityReads = 0;
    assert.equal(await prepareDaniAnamMemoryReviewCandidate({
        session: { ...session, agentSlug: 'amy' },
        receipt,
        turns,
    }, {
        readIdentity: async () => {
            identityReads += 1;
            return identity;
        },
    }), undefined, 'a non-Dani session must produce no candidate');
    assert.equal(identityReads, 0);

    assert.equal(await prepareDaniAnamMemoryReviewCandidate({
        session,
        receipt: {
            ...receipt,
            status: 'transcript_unavailable',
            transcript: {
                source: 'unavailable',
                messageCount: 0,
                contentSha256: null,
                rawTranscriptPersisted: false,
            },
        },
        turns: [],
    }, { readIdentity: async () => identity }), undefined, 'no exact final transcript receipt must produce no candidate');
});

test('sanitized candidate and canonical receipt use one spine Redis transaction', async () => {
    const reviewArtifact = artifact();
    const eligibility = createDaniAnamMemoryCandidateEligibility(identity);
    let command;
    const status = await writeAmyAnamReceipt(session, finalization, receipt, {
        env: spineEnv,
        daniMemoryReviewArtifact: reviewArtifact,
        daniMemoryEligibility: eligibility,
        fetchImpl: async (_url, init) => {
            command = JSON.parse(String(init.body))[0];
            return redisResponse(['candidate_stored']);
        },
    });
    assert.equal(status, 'candidate_stored');
    assert.equal(command[0], 'EVAL');
    assert.equal(command[2], 5, 'receipt and exact candidate key share one EVAL');
    assert.ok(command.includes(`xagent:dani:anam:memory-review-candidate:v1:${EXTERNAL_SESSION_ID}:${reviewArtifact.jobId}`));
    assert.match(command[1], /candidate_conflict/);
    assert.match(command[1], /existingCandidate/);

    const serialized = JSON.stringify(command);
    assert.equal(serialized.includes(reviewArtifact.sourceTranscriptSha256), true);
    assert.equal(serialized.includes('Project Marigold'), false);
    assert.equal(serialized.includes('private@example.com'), false);
    assert.equal(serialized.includes('What business problem should we explore?'), false);
    assert.equal(serialized.includes(identity.emailIdentityHash), false, 'identity linkage stays in Dani Redis');
});

test('candidate conflicts are explicit and do not masquerade as a successful candidate write', async () => {
    const status = await writeAmyAnamReceipt(session, finalization, receipt, {
        env: spineEnv,
        daniMemoryReviewArtifact: artifact(),
        daniMemoryEligibility: createDaniAnamMemoryCandidateEligibility(identity),
        fetchImpl: async () => redisResponse(['candidate_conflict']),
    });
    assert.equal(status, 'candidate_conflict');
});

test('exact candidate reads require the immutable artifact and its canonical final receipt', async () => {
    const reviewArtifact = artifact();
    const stored = await readDaniAnamMemoryReviewCandidate({
        externalSessionId: EXTERNAL_SESSION_ID,
        jobId: reviewArtifact.jobId,
    }, {
        env: spineEnv,
        fetchImpl: async () => redisResponse([
            JSON.stringify(reviewArtifact),
            JSON.stringify(receipt),
        ]),
    });
    assert.deepEqual(stored, reviewArtifact);

    assert.equal(await readDaniAnamMemoryReviewCandidate({
        externalSessionId: EXTERNAL_SESSION_ID,
        jobId: reviewArtifact.jobId,
    }, {
        env: spineEnv,
        fetchImpl: async () => redisResponse([JSON.stringify(reviewArtifact), null]),
    }), null, 'a candidate without its final receipt is unavailable');

    await assert.rejects(readDaniAnamMemoryReviewCandidate({
        externalSessionId: EXTERNAL_SESSION_ID,
        jobId: reviewArtifact.jobId,
    }, {
        env: spineEnv,
        fetchImpl: async () => redisResponse([
            JSON.stringify(reviewArtifact),
            JSON.stringify({
                ...receipt,
                transcript: { ...receipt.transcript, contentSha256: '0'.repeat(64) },
            }),
        ]),
    }), /did not match its canonical receipt/);
});

test('decisions ignore self-authored content and promote only the stored immutable payload', async () => {
    const stored = artifact();
    let promoted;
    const result = await decideStoredDaniAnamMemoryCandidate({
        action: 'approve',
        externalSessionId: stored.externalSessionId,
        jobId: stored.jobId,
        candidateDigest: stored.candidateDigest,
        operatorSecret: 'o'.repeat(48),
        summary: 'operator-authored replacement must be ignored',
    }, {
        readCandidate: async () => stored,
        promote: async candidate => {
            promoted = candidate;
            return { status: 'stored', recordCount: 1, memoryId: 'm'.repeat(64) };
        },
        reject: async () => 'rejected',
    });
    assert.equal(result.decision, 'approved');
    assert.equal(promoted.summary, stored.summary);
    assert.notEqual(promoted.summary, 'operator-authored replacement must be ignored');

    await assert.rejects(decideStoredDaniAnamMemoryCandidate({
        action: 'approve',
        externalSessionId: stored.externalSessionId,
        jobId: stored.jobId,
        candidateDigest: '0'.repeat(64),
        operatorSecret: 'o'.repeat(48),
    }, {
        readCandidate: async () => stored,
        promote: async () => assert.fail('mismatch must not promote'),
        reject: async () => assert.fail('mismatch must not reject'),
    }), /did not match the decision/);

    await assert.rejects(decideStoredDaniAnamMemoryCandidate({
        action: 'approve',
        externalSessionId: stored.externalSessionId,
        jobId: stored.jobId,
        candidateDigest: stored.candidateDigest,
        operatorSecret: 'o'.repeat(48),
    }, {
        readCandidate: async () => stored,
        promote: async () => { throw new Error('Dani memory session identity was unavailable'); },
        reject: async () => 'rejected',
    }), /session identity was unavailable/, 'revocation after finalization must still block promotion');
});

test('review API is exact-job only, bearer protected, and rechecks active Dani consent', async () => {
    const candidateRoute = await readFile(
        new URL('../app/api/anam/dani/memory/candidate/route.ts', import.meta.url),
        'utf8',
    );
    const promotionRoute = await readFile(
        new URL('../app/api/anam/dani/memory/promote/route.ts', import.meta.url),
        'utf8',
    );
    const finalizer = await readFile(
        new URL('../lib/anam/session-finalizer.ts', import.meta.url),
        'utf8',
    );
    assert.match(candidateRoute, /bearerSecret\(request\)/);
    assert.match(candidateRoute, /externalSessionId/);
    assert.match(candidateRoute, /jobId/);
    assert.match(candidateRoute, /candidateDigest/);
    assert.match(candidateRoute, /readDaniAnamSessionMemoryIdentity\(externalSessionId\)/);
    assert.doesNotMatch(candidateRoute, /latest|list|scan/i);
    assert.doesNotMatch(promotionRoute, /'summary'|'inquiryType'|'recommendedNextSteps'/);
    assert.match(promotionRoute, /decideStoredDaniAnamMemoryCandidate/);
    assert.match(finalizer, /if \(existingReceipt\)[\s\S]*return 'completed'/);
});
