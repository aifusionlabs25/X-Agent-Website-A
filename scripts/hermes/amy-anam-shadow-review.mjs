import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    hashAmyAnamHermesShadowOutput,
    parseAmyAnamHermesShadowOutput,
    sanitizeAmyAnamHermesSensitiveText,
} from '../../lib/anam/hermes-shadow.ts';

export const AMY_ANAM_HERMES_LOCAL_REVIEW_VERSION = 'amy_anam_hermes_local_review_v2';
export const AMY_ANAM_HERMES_REVIEW_PRIORITY_VERSION = 'amy_anam_hermes_review_priority_v1';
export const AMY_ANAM_HERMES_LOCAL_REVIEW_RETENTION_MS = 24 * 60 * 60 * 1000;

const REVIEW_PRIORITY_REASONS = [
    ['explicit_human_review', output => output.needs_human_review],
    ['privacy_risk', output => output.quality_review.privacy_risk],
    ['unsupported_claim_risk', output => output.quality_review.unsupported_claim_risk],
    ['pricing_or_inventory_claim_risk', output => (
        output.quality_review.pricing_or_inventory_claim_risk
    )],
    ['technical_term_risk', output => output.quality_review.technical_term_risk],
    ['repeated_question_risk', output => output.quality_review.repeated_question_risk],
];

const HIGH_PRIORITY_REASONS = new Set([
    'explicit_human_review',
    'privacy_risk',
    'unsupported_claim_risk',
    'pricing_or_inventory_claim_risk',
]);

const DEFAULT_OUTPUT_DIR = resolve(tmpdir(), 'xagent-amy-anam-hermes-shadow');
const MAX_LOCAL_OUTPUT_FILE_BYTES = 96 * 1024;
const MAX_FUTURE_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;
const OUTPUT_FILE_PATTERN = /^([a-f0-9]{64})\.([a-f0-9]{64})\.json$/;
const SAFE_FAILURE_MESSAGE = 'Amy Anam Hermes local review failed safely';

class LocalReviewError extends Error {}

function isWithin(basePath, candidatePath) {
    const pathFromBase = relative(resolve(basePath), resolve(candidatePath));
    return Boolean(pathFromBase)
        && !pathFromBase.startsWith('..')
        && !isAbsolute(pathFromBase);
}

export function sanitizeAmyAnamHermesReviewText(value) {
    return sanitizeAmyAnamHermesSensitiveText(value);
}

export function deriveAmyAnamHermesReviewPriority(output) {
    if (
        !output
        || typeof output !== 'object'
        || typeof output.needs_human_review !== 'boolean'
        || !output.quality_review
        || typeof output.quality_review !== 'object'
        || [
            'repeated_question_risk',
            'unsupported_claim_risk',
            'pricing_or_inventory_claim_risk',
            'technical_term_risk',
            'privacy_risk',
        ].some(key => typeof output.quality_review[key] !== 'boolean')
    ) {
        throw new LocalReviewError('Amy Anam Hermes review priority input was invalid');
    }

    const reasonCodes = REVIEW_PRIORITY_REASONS
        .filter(([, applies]) => applies(output))
        .map(([reasonCode]) => reasonCode);
    const priority = reasonCodes.some(reasonCode => HIGH_PRIORITY_REASONS.has(reasonCode))
        ? 'high'
        : reasonCodes.length > 0
            ? 'medium'
            : 'low';

    return {
        schema_version: AMY_ANAM_HERMES_REVIEW_PRIORITY_VERSION,
        priority,
        reason_codes: reasonCodes,
    };
}

async function resolveSafeOutputDirectory(outputDir) {
    const requestedTemp = resolve(tmpdir());
    const requestedDirectory = resolve(outputDir ?? DEFAULT_OUTPUT_DIR);
    let operatingSystemTemp;

    try {
        operatingSystemTemp = await realpath(requestedTemp);
    } catch {
        throw new LocalReviewError('Amy Anam Hermes review could not verify the local temp directory');
    }

    try {
        const canonicalDirectory = await realpath(requestedDirectory);
        if (!isWithin(operatingSystemTemp, canonicalDirectory)) {
            throw new LocalReviewError('Amy Anam Hermes review directory escaped the operating-system temp directory');
        }
        return canonicalDirectory;
    } catch (error) {
        if (error instanceof LocalReviewError) throw error;
        if (error?.code === 'ENOENT') {
            if (!isWithin(requestedTemp, requestedDirectory)) {
                throw new LocalReviewError('Amy Anam Hermes review output must remain inside the operating-system temp directory');
            }
            return null;
        }
        throw new LocalReviewError('Amy Anam Hermes review could not access its local output directory');
    }
}

async function readValidatedOutput(outputDirectory, entry, now) {
    const match = OUTPUT_FILE_PATTERN.exec(entry.name);
    if (!match) return null;
    if (entry.isSymbolicLink()) {
        throw new LocalReviewError('Amy Anam Hermes review refuses symbolic links');
    }
    if (!entry.isFile()) return null;

    const outputPath = resolve(outputDirectory, entry.name);
    if (!isWithin(outputDirectory, outputPath)) {
        throw new LocalReviewError('Amy Anam Hermes review path escaped its directory');
    }

    let fileHandle;
    let metadata;
    let rawOutput;
    try {
        const pathMetadata = await lstat(outputPath);
        if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink() || pathMetadata.nlink !== 1) {
            throw new LocalReviewError('Amy Anam Hermes review requires one regular local file');
        }
        fileHandle = await open(outputPath, 'r');
        metadata = await fileHandle.stat();
        if (
            !metadata.isFile()
            || metadata.nlink !== 1
            || metadata.dev !== pathMetadata.dev
            || metadata.ino !== pathMetadata.ino
        ) {
            throw new LocalReviewError('Amy Anam Hermes review file changed during validation');
        }
        if (metadata.size <= 0 || metadata.size > MAX_LOCAL_OUTPUT_FILE_BYTES) {
            throw new LocalReviewError('Amy Anam Hermes review file exceeded its safety bound');
        }
        rawOutput = await fileHandle.readFile('utf8');
    } catch (error) {
        if (error instanceof LocalReviewError) throw error;
        throw new LocalReviewError('Amy Anam Hermes review could not safely read a local output');
    } finally {
        await fileHandle?.close().catch(() => undefined);
    }

    const birthTime = metadata.birthtimeMs > 0 ? metadata.birthtimeMs : metadata.mtimeMs;
    if (
        metadata.mtimeMs > now + MAX_FUTURE_TIMESTAMP_SKEW_MS
        || birthTime > now + MAX_FUTURE_TIMESTAMP_SKEW_MS
    ) {
        throw new LocalReviewError('Amy Anam Hermes review rejected a future-dated local output');
    }
    const observedAt = Math.min(metadata.mtimeMs, birthTime);
    if (now - observedAt > AMY_ANAM_HERMES_LOCAL_REVIEW_RETENTION_MS) return null;

    let compactOutput;
    try {
        compactOutput = JSON.stringify(JSON.parse(rawOutput));
    } catch {
        throw new LocalReviewError('Amy Anam Hermes review file was not valid JSON');
    }
    let output;
    try {
        output = parseAmyAnamHermesShadowOutput(compactOutput);
    } catch {
        throw new LocalReviewError('Amy Anam Hermes review file failed schema validation');
    }
    if (hashAmyAnamHermesShadowOutput(output) !== match[2]) {
        throw new LocalReviewError('Amy Anam Hermes review file failed its content hash check');
    }

    return {
        jobId: match[1],
        outputSha256: match[2],
        observedAt,
        output,
    };
}

export async function readAmyAnamHermesLocalReviews(options = {}) {
    const outputDirectory = await resolveSafeOutputDirectory(options.outputDir);
    if (!outputDirectory) return [];
    const now = typeof options.now === 'number' && Number.isFinite(options.now)
        ? options.now
        : Date.now();

    const reviews = [];
    let entries;
    try {
        entries = await readdir(outputDirectory, { withFileTypes: true });
    } catch {
        throw new LocalReviewError('Amy Anam Hermes review could not enumerate local outputs');
    }
    for (const entry of entries) {
        const review = await readValidatedOutput(outputDirectory, entry, now);
        if (review) reviews.push(review);
    }

    reviews.sort((left, right) => right.observedAt - left.observedAt);
    return options.all === true ? reviews : reviews.slice(0, 1);
}

function yesNo(value) {
    return value ? 'YES' : 'no';
}

export function renderAmyAnamHermesLocalReviews(reviews) {
    const lines = [
        'AMY ANAM HERMES LOCAL REVIEW',
        'ANALYSIS ONLY - NO AUTHORITY',
        'Read-only local output. This viewer cannot approve, apply, send, store, or trigger anything.',
        '',
    ];

    if (reviews.length === 0) {
        lines.push('No local Hermes shadow outputs are available.');
        return `${lines.join('\n')}\n`;
    }

    reviews.forEach((review, index) => {
        const { output } = review;
        const risks = output.quality_review;
        const reviewPriority = deriveAmyAnamHermesReviewPriority(output);
        lines.push(`REVIEW ${index + 1} OF ${reviews.length}`);
        lines.push(`Suggested review priority (rule-based, no authority): ${reviewPriority.priority.toUpperCase()}`);
        lines.push(`Model-flag reason codes: ${reviewPriority.reason_codes.join(', ') || 'none'}`);
        lines.push(`Inquiry type: ${sanitizeAmyAnamHermesReviewText(output.inquiry_type)}`);
        lines.push(`Summary: ${sanitizeAmyAnamHermesReviewText(output.summary)}`);
        lines.push(`Hermes requested human review: ${yesNo(output.needs_human_review)}`);
        lines.push('Recommended next steps:');
        if (output.recommended_next_steps.length === 0) {
            lines.push('  - none');
        } else {
            for (const nextStep of output.recommended_next_steps) {
                lines.push(`  - ${sanitizeAmyAnamHermesReviewText(nextStep)}`);
            }
        }
        lines.push('Risk checks:');
        lines.push(`  - repeated question: ${yesNo(risks.repeated_question_risk)}`);
        lines.push(`  - unsupported claim: ${yesNo(risks.unsupported_claim_risk)}`);
        lines.push(`  - pricing or inventory claim: ${yesNo(risks.pricing_or_inventory_claim_risk)}`);
        lines.push(`  - technical term: ${yesNo(risks.technical_term_risk)}`);
        lines.push(`  - privacy: ${yesNo(risks.privacy_risk)}`);
        lines.push('Safety proof: shadow only; tools 0; emails 0; memory writes 0; outbound actions 0.');
        if (index < reviews.length - 1) lines.push('', '---', '');
    });

    return `${lines.join('\n')}\n`;
}

function readCommandMode(args) {
    if (args.length === 0 || (args.length === 1 && args[0] === '--latest')) return { all: false };
    if (args.length === 1 && args[0] === '--all') return { all: true };
    throw new Error('Use --latest or --all');
}

async function main() {
    const mode = readCommandMode(process.argv.slice(2));
    const reviews = await readAmyAnamHermesLocalReviews(mode);
    process.stdout.write(renderAmyAnamHermesLocalReviews(reviews));
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
    main().catch(() => {
        process.stderr.write(`${SAFE_FAILURE_MESSAGE}\n`);
        process.exitCode = 1;
    });
}
