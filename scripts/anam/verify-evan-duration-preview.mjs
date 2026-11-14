// Import-safe, immutable rehearsal verification. No engine/call/email is started.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runDurationBoundaryVerification } from './verify-evan-duration-production.mjs';

export function previewVerificationTarget(preview) {
    let target;
    try { target = new URL(preview?.url); } catch { throw new Error('Invalid rehearsal target'); }
    if (preview?.environment !== 'amy-ceo-rehearsal'
        || target.protocol !== 'https:'
        || !/^x-agent-website-[a-z0-9]+-robs-projects-e72bad73\.vercel\.app$/.test(target.hostname)
        || target.port || target.username || target.password || target.search || target.hash || target.pathname !== '/') {
        throw new Error('Only an exact immutable rehearsal origin is allowed');
    }
    return target;
}

export async function runPreviewDurationVerification({ preview, privateCode, fetchImpl = fetch, shareUrl }) {
    const target = previewVerificationTarget(preview);
    return runDurationBoundaryVerification({ target, privateCode, fetchImpl, shareUrl, resultInfo: {
        mode: 'preview', environment: 'amy-ceo-rehearsal', immutableOrigin: target.origin,
        ...(preview.sourceCommit ? { sourceCommit: preview.sourceCommit } : {}),
        ...(preview.deploymentId ? { deploymentId: preview.deploymentId } : {}),
        productionChanged: false,
    } });
}

async function main() {
    if (process.argv.length !== 2) throw new Error('No CLI arguments are supported');
    const preview = JSON.parse(readFileSync('.vercel/evan-duration-preview.json', 'utf8'));
    const { code } = JSON.parse(readFileSync('.vercel/evan-duration-private-access.json', 'utf8'));
    const result = await runPreviewDurationVerification({ preview, privateCode: code, shareUrl: process.env.EVAN_PREVIEW_SHARE_URL });
    writeFileSync('.vercel/evan-duration-verification.json', JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(() => {
        console.error('FAIL Rehearsal verification setup failed; details redacted.');
        process.exitCode = 1;
    });
}
