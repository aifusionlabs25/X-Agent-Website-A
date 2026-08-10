import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDaniAnamMemoryReviewArtifact } from '../../lib/anam/dani-memory-candidate.ts';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const SAFE_REASON_PATTERN = /^[a-z0-9_-]{3,64}$/;
const MAX_RESPONSE_BYTES = 32 * 1024;

function oneValue(args, prefix, required = true) {
    const matches = args.filter(argument => argument.startsWith(prefix));
    if (matches.length > 1) throw new Error(`${prefix.slice(0, -1)} may be supplied only once`);
    const current = matches[0]?.slice(prefix.length).trim() ?? '';
    if (required && !current) throw new Error(`${prefix.slice(0, -1)} is required`);
    return current;
}

export function parseDaniMemoryReviewArgs(args) {
    if (args.includes('--latest') || args.includes('--all')) {
        throw new Error('Dani memory review requires one explicit stored job and exact identifiers');
    }
    const allowed = [
        '--review',
        '--approve',
        '--reject',
        '--external-session-id=',
        '--job-id=',
        '--candidate-digest=',
        '--reason=',
    ];
    if (args.some(argument => !allowed.some(item => (
        item.endsWith('=') ? argument.startsWith(item) : argument === item
    )))) {
        throw new Error('Dani memory review contained an unsupported argument');
    }

    const selectedModes = ['review', 'approve', 'reject'].filter(mode => args.includes(`--${mode}`));
    if (selectedModes.length !== 1) {
        throw new Error('Choose exactly one of --review, --approve, or --reject');
    }
    const mode = selectedModes[0];
    const externalSessionId = oneValue(args, '--external-session-id=');
    const jobId = oneValue(args, '--job-id=').toLowerCase();
    const candidateDigest = oneValue(args, '--candidate-digest=').toLowerCase();
    const reasonCode = oneValue(args, '--reason=', false) || 'operator_rejected';

    if (!SAFE_SESSION_ID_PATTERN.test(externalSessionId)) {
        throw new Error('The exact Dani external session ID was invalid');
    }
    if (!SHA256_PATTERN.test(jobId) || !SHA256_PATTERN.test(candidateDigest)) {
        throw new Error('The exact Dani job ID and candidate digest must be SHA-256 values');
    }
    if (mode !== 'reject' && args.some(argument => argument.startsWith('--reason='))) {
        throw new Error('--reason is available only with --reject');
    }
    if (!SAFE_REASON_PATTERN.test(reasonCode)) {
        throw new Error('The Dani rejection reason code was invalid');
    }

    return { mode, externalSessionId, jobId, candidateDigest, reasonCode };
}

function envValue(source, name) {
    return String(source[name] ?? '').trim();
}

function isExactApiUrl(value, expectedPath) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && Boolean(url.hostname)
            && !url.username
            && !url.password
            && !url.search
            && !url.hash
            && url.pathname === expectedPath;
    } catch {
        return false;
    }
}

function exactArtifactMatch(artifact, options) {
    return artifact.externalSessionId === options.externalSessionId
        && artifact.jobId === options.jobId
        && artifact.candidateDigest === options.candidateDigest;
}

function responseLabel(value, fallback) {
    return typeof value === 'string' && /^[a-z0-9_-]{1,64}$/i.test(value)
        ? value
        : fallback;
}

async function boundedJson(response, label) {
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new Error(`${label} response was too large`);
    }
    try {
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

async function fetchExactStoredCandidate(options) {
    const url = new URL(options.candidateUrl);
    url.searchParams.set('externalSessionId', options.parsed.externalSessionId);
    url.searchParams.set('jobId', options.parsed.jobId);
    url.searchParams.set('candidateDigest', options.parsed.candidateDigest);
    const response = await options.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${options.operatorSecret}` },
        signal: AbortSignal.timeout(8_000),
    });
    const result = await boundedJson(response, 'Dani memory candidate');
    if (!response.ok) throw new Error(`Dani memory candidate read failed safely (${response.status})`);
    const artifact = assertDaniAnamMemoryReviewArtifact(result.candidate);
    if (!exactArtifactMatch(artifact, options.parsed)) {
        throw new Error('Stored Dani memory candidate did not match every exact operator-supplied identifier');
    }
    return artifact;
}

export async function runDaniMemoryReview(options = {}) {
    const parsed = options.parsed ?? parseDaniMemoryReviewArgs(options.args ?? process.argv.slice(2));
    const env = options.env ?? process.env;
    const candidateUrl = String(
        options.candidateUrl ?? envValue(env, 'DANI_ANAM_MEMORY_CANDIDATE_URL'),
    ).trim();
    const operatorSecret = String(
        options.operatorSecret ?? envValue(env, 'DANI_ANAM_MEMORY_OPERATOR_SECRET'),
    ).trim();
    if (
        !isExactApiUrl(candidateUrl, '/api/anam/dani/memory/candidate')
        || operatorSecret.length < 32
    ) {
        throw new Error('Dani memory candidate URL or operator secret is unavailable');
    }
    const fetchImpl = options.fetchImpl ?? fetch;
    const artifact = await fetchExactStoredCandidate({
        candidateUrl,
        operatorSecret,
        parsed,
        fetchImpl,
    });
    if (parsed.mode === 'review') return { mode: 'review', artifact };

    const promotionUrl = String(
        options.promotionUrl ?? envValue(env, 'DANI_ANAM_MEMORY_PROMOTION_URL'),
    ).trim();
    if (!isExactApiUrl(promotionUrl, '/api/anam/dani/memory/promote')) {
        throw new Error('Dani memory promotion URL is unavailable');
    }
    const response = await fetchImpl(promotionUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${operatorSecret}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            action: parsed.mode,
            externalSessionId: artifact.externalSessionId,
            jobId: artifact.jobId,
            candidateDigest: artifact.candidateDigest,
            ...(parsed.mode === 'reject' ? { reasonCode: parsed.reasonCode } : {}),
        }),
        signal: AbortSignal.timeout(8_000),
    });
    const result = await boundedJson(response, 'Dani memory decision');
    if (!response.ok) throw new Error(`Dani memory decision failed safely (${response.status})`);

    return {
        mode: parsed.mode,
        decision: responseLabel(result.decision, parsed.mode),
        status: responseLabel(result.status, 'recorded'),
        recordCount: Number.isSafeInteger(result.recordCount) ? result.recordCount : undefined,
        memoryId: typeof result.memoryId === 'string' ? result.memoryId : undefined,
    };
}

const isMain = process.argv[1]
    && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
    runDaniMemoryReview()
        .then(result => {
            if (result.mode === 'review') {
                process.stdout.write(`${JSON.stringify(result.artifact, null, 2)}\n`);
                return;
            }
            const count = Number.isSafeInteger(result.recordCount)
                ? `; approved memory count ${result.recordCount}`
                : '';
            process.stdout.write(`Dani memory decision recorded: ${result.decision} (${result.status})${count}.\n`);
        })
        .catch(error => {
            process.stderr.write(`${error instanceof Error ? error.message : 'Dani memory review failed safely'}\n`);
            process.exitCode = 1;
        });
}
