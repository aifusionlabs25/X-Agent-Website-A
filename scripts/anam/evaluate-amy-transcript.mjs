#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluateAmyTranscript } from '../../lib/anam/amy-live-qa.ts';

const inputs = process.argv.slice(2).filter((value) => value !== '--json');
if (!inputs.length) {
    process.stderr.write('Usage: npm run amy:transcript-qa -- <transcript.txt> [...]\n');
    process.exit(2);
}

const results = [];
for (const input of inputs) {
    const label = path.resolve(input);
    results.push({ label, report: evaluateAmyTranscript(await fs.readFile(label, 'utf8')) });
}
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
process.exitCode = results.some(({ report }) => report.status === 'fail') ? 1 : 0;
