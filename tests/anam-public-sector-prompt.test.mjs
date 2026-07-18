import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const guidance = await readFile(
    new URL('../config/anam/amy-public-sector-upgrade.md', import.meta.url),
    'utf8',
);
const updater = await readFile(
    new URL('../scripts/anam/update-amy-cara4-reliability.mjs', import.meta.url),
    'utf8',
);

test('Anam Amy has explicit Public Sector recognition and procurement literacy', () => {
    assert.match(guidance, /federal, state, local/i);
    assert.match(guidance, /courts, public safety/i);
    assert.match(guidance, /K-12, higher education/i);
    assert.match(guidance, /NASPO ValuePoint/);
    assert.match(guidance, /GSA schedules/);
    assert.match(guidance, /SEWP/);
    assert.match(guidance, /OMNIA Partners/);
    assert.match(guidance, /Sourcewell/);
    assert.match(guidance, /purchasing paths or contract vehicles/i);
});

test('Public Sector guidance covers mission discovery without inventing compliance or eligibility', () => {
    assert.match(guidance, /citizen services/i);
    assert.match(guidance, /continuity of operations/i);
    assert.match(guidance, /FedRAMP, StateRAMP, NIST, FISMA, CJIS, HIPAA/);
    assert.match(guidance, /Ask which requirements actually apply/i);
    assert.match(guidance, /Never claim.*compliant, authorized, eligible, approved/s);
    assert.match(guidance, /Never promise contract eligibility, pricing, discounts, inventory/s);
    assert.match(guidance, /Insight Public Sector specialist/i);
});

test('the live updater manages and verifies the Public Sector block idempotently', () => {
    assert.match(updater, /amy-public-sector-upgrade\.md/);
    assert.match(updater, /PUBLIC_SECTOR_START/);
    assert.match(updater, /PUBLIC_SECTOR_END/);
    assert.match(updater, /replaceManagedBlock/);
    assert.match(updater, /publicSectorConfigured/);
});
