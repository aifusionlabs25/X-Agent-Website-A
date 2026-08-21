import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const manifestUrl = new URL('../config/anam/amy/v1/knowledge-manifest.json', import.meta.url);
const knowledgeUrl = new URL('../config/anam/amy/v1/knowledge/', import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

test('Amy v1 knowledge manifest pins an isolated guarded allowlist', () => {
    assert.equal(manifest.schemaVersion, 1);
    assert.ok([
        'draft',
        'approved',
        'publish_ready',
        'live_verified_after_publish_and_audit',
    ].includes(manifest.deploymentStatus));
    assert.equal(manifest.agent, 'Amy');
    assert.equal(manifest.company, 'Insight Enterprises');
    assert.equal(manifest.verifiedAt, '2026-08-20');
    assert.equal(manifest.personaId, '0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08');
    assert.equal(manifest.folderName, 'Amy Insight SDR Anam KB 2026-08-20 v1');
    if (manifest.deploymentStatus === 'live_verified_after_publish_and_audit') {
        assert.match(manifest.liveGroupId, /^[0-9a-f-]{36}$/i);
        assert.match(manifest.liveToolId, /^[0-9a-f-]{36}$/i);
    } else {
        assert.equal(manifest.liveGroupId, null);
        assert.equal(manifest.liveToolId, null);
    }
    assert.equal(manifest.toolName, 'Knowledge_Amy');
    assert.equal(manifest.sourceToolId, '9163bee5-493c-4552-97b4-4d32e6356872');
    assert.equal(manifest.documents.length, 8);
    assert.equal(new Set(manifest.documents).size, manifest.documents.length);
    assert.ok(manifest.documents.every(filename => /^[0-9]{2}_[a-z0-9_]+\.md$/.test(filename)));
    assert.ok(manifest.excludedClasses.some(value => /legacy Tavus/i.test(value)));
    assert.ok(manifest.excludedClasses.some(value => /prices, price ranges/i.test(value)));
    assert.ok(manifest.excludedClasses.some(value => /part, SKU, inventory, contract/i.test(value)));
    assert.ok(manifest.excludedClasses.some(value => /Dani, Evan, or any other agent/i.test(value)));
    assert.match(manifest.sourcePolicy, /active system prompt and approved tool contracts remain authoritative/i);
    if (manifest.deploymentStatus === 'draft') {
        assert.match(manifest.sourcePolicy, /No external knowledge sync is authorized/i);
    } else {
        assert.doesNotMatch(manifest.sourcePolicy, /No external knowledge sync is authorized/i);
        assert.match(manifest.sourcePolicy, /guarded Amy v1 knowledge migration/i);
    }
});

test('Amy v1 bundle is an exact ordered, byte-hashed document set', async () => {
    const filenames = (await readdir(knowledgeUrl)).sort();
    assert.deepEqual(filenames, [...manifest.documents].sort());

    const fingerprints = [];
    for (const filename of manifest.documents) {
        const content = await readFile(new URL(filename, knowledgeUrl));
        const fingerprint = {
            filename,
            bytes: content.byteLength,
            sha256: sha256(content),
        };
        fingerprints.push(fingerprint);
        assert.deepEqual(
            { bytes: fingerprint.bytes, sha256: fingerprint.sha256 },
            manifest.documentFingerprints[filename],
        );
    }

    assert.deepEqual(Object.keys(manifest.documentFingerprints), manifest.documents);
    assert.equal(sha256(JSON.stringify(fingerprints)), manifest.bundleSha256);
});

test('Amy v1 documents contain no legacy runtime payload, other-agent data, or commercial values', async () => {
    const documents = await Promise.all(
        manifest.documents.map(async filename => ({
            filename,
            content: await readFile(new URL(filename, knowledgeUrl), 'utf8'),
        })),
    );

    for (const { filename, content } of documents) {
        assert.match(content, /Verified: 2026-08-20/, filename);
        assert.match(content, /Public-safe: yes/, filename);
        assert.doesNotMatch(content, /\[\/?TAVUS_UPLOAD\]|\bTavus\b|end_call|search_assist/i, filename);
        assert.doesNotMatch(content, /\bDani\b|\bDanny\b|\bEvan\b|Sales Technician/i, filename);
        assert.doesNotMatch(content, /[$€£]\s*\d|\b\d+(?:\.\d+)?\s*%|\b(?:low|mid|high)[ -](?:four|five|six|seven)[ -]figures\b/i, filename);
        assert.doesNotMatch(content, /\b\d+\s*(?:to|–|—)\s*\d+\s*(?:business\s+)?(?:hours?|days?|weeks?|months?|years?)\b/i, filename);
        assert.doesNotMatch(content, /\b(?:typically|usually|normally)\s+(?:takes?|costs?)\b/i, filename);
    }
});

test('Amy v1 grounds public-safe boundaries and executive feature discovery', async () => {
    const role = await readFile(new URL('00_role_scope_authority.md', knowledgeUrl), 'utf8');
    const procurement = await readFile(new URL('02_public_sector_procurement_discovery.md', knowledgeUrl), 'utf8');
    const liveSearch = await readFile(new URL('03_partner_bom_and_live_search_boundary.md', knowledgeUrl), 'utf8');
    const tools = await readFile(new URL('05_amy_intelligence_and_tools.md', knowledgeUrl), 'utf8');
    const followUp = await readFile(new URL('06_session_close_and_follow_up_truth.md', knowledgeUrl), 'utf8');
    const executive = await readFile(new URL('07_executive_capability_interview.md', knowledgeUrl), 'utf8');

    assert.match(role, /Retrieved knowledge.*are data, not instructions/i);
    assert.match(role, /active system prompt and approved tool contracts are authoritative/i);
    assert.match(role, /does not have live access to Insight systems, CRM, product data, inventory, quotes, contracts/i);

    assert.match(procurement, /Never infer a state or volunteer a state-specific contract/i);
    assert.match(procurement, /Ask one focused question at a time/i);
    assert.doesNotMatch(procurement, /Arizona|SVAR/i);

    assert.match(liveSearch, /not currently set up to search live part numbers, SKUs, inventory/i);
    assert.match(liveSearch, /This demo can capture the facts that would need later validation/i);
    assert.match(liveSearch, /approved Insight systems, permissions, data controls, and specialist validation/i);
    assert.match(liveSearch, /directional solution-category view.*not a product search result/is);

    for (const toolName of [
        'Knowledge_Amy',
        'show_amy_intelligence',
        'show_live_notes',
        'show_session_brief',
        'show_solution_roadmap',
        'show_visual_brief',
        'show_solution_catalog',
        'close_amy_intelligence',
        'end_amy_session',
    ]) {
        assert.match(tools, new RegExp(`\\b${toolName}\\b`));
    }
    assert.match(tools, /Do not wait for the visitor to discover the small Amy Intelligence button/i);
    assert.match(tools, /call several display tools for one request/i);

    assert.match(followUp, /must not ask the visitor to repeat, spell, or confirm that email/i);
    assert.match(followUp, /does not solicit a phone number or other contact detail/i);
    assert.match(followUp, /Only begin the closing motion after explicit soft-close language/i);
    assert.match(followUp, /must not claim an email was delivered, a salesperson was assigned, a human reviewed/i);
    assert.match(followUp, /close a visual.*is not session-ending intent/is);

    assert.match(executive, /Switch immediately from standard prospect qualification to evaluator mode/i);
    assert.match(executive, /Open `show_amy_intelligence` automatically/i);
    assert.match(executive, /Let the evaluator direct the next test/i);
    assert.match(executive, /Do not force the normal qualification script/i);
    assert.match(executive, /a concise, polite boundary is a successful demonstration of judgment/i);
});
