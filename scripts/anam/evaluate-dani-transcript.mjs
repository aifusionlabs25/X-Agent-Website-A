#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
    evaluateDaniTranscript,
    formatDaniLiveQaReport,
} from '../../lib/anam/dani-live-qa.ts';

const usage = `Usage:
  node --experimental-strip-types scripts/anam/evaluate-dani-transcript.mjs [--json] <transcript.txt> [...]
  node --experimental-strip-types scripts/anam/evaluate-dani-transcript.mjs [--json] -

The command is offline-only. It exits 1 when any transcript contains a critical
Dani live-QA failure, 2 for usage/read errors, and 0 when no critical failure is found.`;

const args = process.argv.slice(2);
const json = args.includes('--json');
const help = args.includes('--help') || args.includes('-h');
const inputs = args.filter(value => !['--json', '--help', '-h'].includes(value));

if (help) {
    process.stdout.write(`${usage}\n`);
    process.exit(0);
}

if (!inputs.length || (inputs.includes('-') && inputs.length > 1)) {
    process.stderr.write(`${usage}\n`);
    process.exit(2);
}

async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
}

try {
    const results = [];
    for (const input of inputs) {
        const label = input === '-' ? 'stdin' : path.resolve(input);
        const transcript = input === '-' ? await readStdin() : await fs.readFile(label, 'utf8');
        results.push({ label, report: evaluateDaniTranscript(transcript) });
    }

    if (json) {
        process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    } else {
        process.stdout.write(`${results
            .map(({ label, report }) => formatDaniLiveQaReport(report, label))
            .join('\n\n')}\n`);
    }

    process.exitCode = results.some(({ report }) => report.status === 'fail') ? 1 : 0;
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Unable to evaluate Dani transcript: ${message}\n`);
    process.exitCode = 2;
}
