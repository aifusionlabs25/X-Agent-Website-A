import { readAmyAnamHermesLocalReviews } from './amy-anam-shadow-review.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function readMode(args) {
    const approve = args.includes('--approve');
    const reject = args.includes('--reject');
    if (approve === reject) throw new Error('Choose exactly one of --approve or --reject');
    const reason = args.find(argument => argument.startsWith('--reason='))?.slice(9) || 'operator_rejected';
    return { approve, reason };
}

function envValue(name) {
    return String(process.env[name] ?? '').trim();
}

export async function decideLatestAmyAnamMemory(options = {}) {
    const mode = options.mode ?? readMode(process.argv.slice(2));
    const promotionUrl = options.promotionUrl ?? envValue('AMY_ANAM_MEMORY_PROMOTION_URL');
    const operatorSecret = options.operatorSecret ?? envValue('AMY_ANAM_MEMORY_OPERATOR_SECRET');
    if (!/^https:\/\//.test(promotionUrl) || operatorSecret.length < 32) {
        throw new Error('Memory promotion URL or operator secret is unavailable');
    }
    const [review] = await readAmyAnamHermesLocalReviews({ outputDir: options.outputDir });
    if (!review) throw new Error('No current Hermes review candidate is available');
    const body = mode.approve
        ? {
            decision: 'approve',
            jobId: review.jobId,
            outputSha256: review.outputSha256,
            summary: review.output.summary,
            inquiryType: review.output.inquiry_type,
            recommendedNextSteps: review.output.recommended_next_steps,
        }
        : {
            decision: 'reject',
            jobId: review.jobId,
            outputSha256: review.outputSha256,
            reasonCode: mode.reason,
        };
    const response = await (options.fetchImpl ?? fetch)(promotionUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${operatorSecret}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Memory decision failed safely (${response.status})`);
    return result;
}

const isMain = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
    decideLatestAmyAnamMemory()
        .then(result => {
            const count = Number.isInteger(result.approvedMemoryCount)
                ? `; approved memory count ${result.approvedMemoryCount}`
                : '';
            process.stdout.write(`Amy memory decision recorded: ${result.decision} (${result.status})${count}.\n`);
        })
        .catch(error => {
            process.stderr.write(`${error instanceof Error ? error.message : 'Memory decision failed safely'}\n`);
            process.exitCode = 1;
        });
}
