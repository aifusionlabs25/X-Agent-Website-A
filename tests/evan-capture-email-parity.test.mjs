import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEvanEmailBundle, buildEvanGuestLeadBrief, buildEvanMovingIntake, redactEvanTranscript } from '../lib/anam/evan-agentmail-templates.ts';
import { projectEvanCaptureContact, projectEvanCaptureIntake, projectEvanCapturePlan, validateEvanCapture } from '../lib/anam/evan-capture.ts';

const user = content => ({ role: 'user', content });
const fact = (category, value, turn, quote, extra = {}) => ({ category, value, status: 'asserted', evidence: [{ turn, quote }], location: 'unspecified', scope: '', quantity: '', route: null, ...extra });

test('validated capture labels are not clipped when a combined HTML recap exceeds the legacy formatter limit', () => {
    const labels = Array.from({ length: 100 }, (_, index) => `item ${index + 1} ${'synthetic '.repeat(33)}ending marker ${index + 1}`);
    const turns = labels.map(content => ({ role: 'user', content }));
    const captureRecord = validateEvanCapture({ facts: labels.map((value, index) => fact('inventory', value, index, value)) }, turns, 1);
    const bundle = buildEvanEmailBundle({ displayName: 'Synthetic Visitor', verifiedEmail: 'visitor@example.test',
        externalSessionId: 'html-boundary-test', sessionStartedAt: '2026-10-21T10:00:00Z',
        sessionEndedAt: '2026-10-21T10:05:00Z', turns, captureRecord });
    for (const audience of ['visitor', 'admin', 'sales']) {
        for (const value of labels) {
            assert.ok(bundle[audience].text.includes(value), `${audience} text lost a validated label`);
            assert.ok(bundle[audience].html.includes(value), `${audience} HTML lost a validated label`);
        }
    }
});
const capture = (turns, facts) => validateEvanCapture({ facts }, turns, 1);
const bundleFor = (turns, captureRecord, extra = {}) => buildEvanEmailBundle({
    displayName: 'Previous Name', verifiedEmail: 'verified@example.test', externalSessionId: 'capture-email-fixture',
    sessionStartedAt: '2026-10-21T12:00:00Z', sessionEndedAt: '2026-10-21T12:05:00Z', turns,
    ...(captureRecord ? { captureRecord } : {}), ...extra,
});
const bodies = bundle => bundle.visitor.text + bundle.visitor.html + bundle.sales.text + bundle.sales.html + bundle.admin.text + bundle.admin.html;
const oldLead = { displayName: 'Previous Name', nameForReview: 'Stale Review Name', phone: '6025550123', email: 'old@example.test',
    emailForReview: 'other-old@example.test', requestedFollowUp: true, callbackWindow: 'morning' };

test('all email audiences share arbitrary move items and quantities with the planner projection', () => {
    const text = 'I have two armoires, a credenza, three barstools, and a walnut sideboard.';
    const turns = [user(text)];
    const record = capture(turns, [fact('inventory', 'armoires', 0, text, { quantity: 'two' }), fact('inventory', 'credenza', 0, text),
        fact('inventory', 'barstools', 0, text, { quantity: 'three' }), fact('inventory', 'walnut sideboard', 0, text)]);
    const bundle = bundleFor(turns, record), plan = projectEvanCapturePlan(record);
    assert.deepEqual(bundle.intake, projectEvanCaptureIntake(record));
    assert.deepEqual(bundle.intake.inventory, plan.inventoryItems);
    for (const item of plan.inventoryItems) for (const audience of ['visitor', 'admin', 'sales']) {
        assert.ok(bundle[audience].text.includes(item), `${audience}: ${item}`);
        assert.ok(bundle[audience].html.includes(item), `${audience} HTML: ${item}`);
    }
    assert.match(bundle.sales.text, /Move items mentioned/);
    assert.doesNotMatch(bodies(bundle), /Specialty items|Specialty \/ high-care|Services and special items/);
});

test('a supplied capture never falls back to finite-regex transcript facts', () => {
    const turns = [user('There is a piano and stairs at pickup.')];
    const bundle = bundleFor(turns, capture(turns, []));
    assert.deepEqual(bundle.intake.inventory, []);
    assert.deepEqual(bundle.intake.access, []);
    assert.doesNotMatch(bodies(bundle), /piano|Stairs at|Origin: stairs/);
    assert.match(bundle.admin.attachments[0].content, /There is a piano and stairs at pickup/);
});

test('removed furniture and access never reappear in any email summary', () => {
    const turns = [user('I have a piano and stairs at pickup.'), user('Remove the piano. There are no stairs at pickup.')];
    const record = capture(turns, [fact('specialty', 'piano', 0, turns[0].content),
        fact('access', 'stairs', 0, turns[0].content, { location: 'origin' }),
        fact('specialty', 'piano', 1, turns[1].content, { status: 'removed' }),
        fact('access', 'stairs', 1, turns[1].content, { status: 'removed', location: 'origin' })]);
    const bundle = bundleFor(turns, record);
    assert.deepEqual(bundle.intake.inventory, projectEvanCapturePlan(record).specialtyItems);
    assert.deepEqual(bundle.intake.access, projectEvanCapturePlan(record).accessFactors);
    assert.doesNotMatch(bodies(bundle), /piano|Stairs at|Origin: stairs/);
});

test('caller name and corrected phone come from current capture while delivery email remains separate', () => {
    const turns = [user('My name is Joan. My phone is 602-555-0123.'),
        user('You can call me Jo. My phone is 602-555-0199. My email is alternate@example.test.')];
    const record = capture(turns, [fact('name', 'Joan', 0, turns[0].content), fact('phone', '602-555-0123', 0, turns[0].content),
        fact('name', 'Jo', 1, turns[1].content), fact('phone', '602-555-0199', 1, turns[1].content),
        fact('email', 'alternate@example.test', 1, turns[1].content)]);
    const bundle = bundleFor(turns, record);
    const contact = projectEvanCaptureContact(record, { displayName: 'Previous Name', email: 'verified@example.test' });
    assert.equal(contact.displayName, 'Jo');
    assert.match(bundle.visitor.text, /^Hi Jo,/);
    assert.match(bundle.sales.text, /Customer: Jo\n/);
    assert.match(bundle.admin.text, /Visitor: Jo\n/);
    assert.ok(bundle.sales.text.includes(contact.phone));
    assert.ok(bundle.admin.text.includes(contact.phone));
    assert.match(bundle.sales.text, /Phone shared \(verify before follow-up\): \(602\) 555-0199/);
    assert.doesNotMatch(bodies(bundle), /Previous Name|Joan|602-555-0123|alternate@example\.test|Authorized callback/);
    assert.match(bundle.sales.text, /verified@example\.test \(secure website check-in\)/);
    assert.doesNotMatch(bundle.admin.attachments[0].content, /602-555-0123|602-555-0199|alternate@example\.test/);
});

test('name and phone tombstones do not resurrect old template identity or contact values', () => {
    const turns = [user('My name is Jo. My phone is 602-555-0123.'), user('Please remove my name and phone.')];
    const record = capture(turns, [fact('name', 'Jo', 0, turns[0].content), fact('phone', '602-555-0123', 0, turns[0].content),
        fact('name', 'name', 1, turns[1].content, { status: 'removed' }), fact('phone', 'phone', 1, turns[1].content, { status: 'removed' })]);
    const bundle = bundleFor(turns, record);
    assert.match(bundle.visitor.text, /^Hi there,/);
    assert.match(bundle.sales.text, /Customer: Visitor/);
    assert.doesNotMatch(bodies(bundle), /Previous Name|Customer: Jo|Visitor: Jo|602-555-0123|\(602\) 555-0123/);
    assert.match(bundle.sales.text, /verified@example\.test/);
});

test('uncertainty and ordinary questions remain uncertain and are not mislabeled as quote or specialty requests', () => {
    const text = 'Maybe the credenza too. I do not know the access. How should I label boxes?';
    const turns = [user(text)];
    const record = capture(turns, [fact('inventory', 'credenza', 0, text, { status: 'tentative' }),
        fact('access', 'access', 0, text, { status: 'unknown' }), fact('question', 'How should I label boxes?', 0, text)]);
    const bundle = bundleFor(turns, record), plan = projectEvanCapturePlan(record);
    assert.deepEqual(bundle.intake.unknowns, plan.uncertainties);
    assert.deepEqual(bundle.intake.inventory, []);
    for (const audience of ['visitor', 'sales', 'admin']) {
        assert.match(bundle[audience].text, /Possible: credenza/);
        assert.match(bundle[audience].text, /How should I label boxes\?/);
    }
    assert.match(bundle.sales.text, /Visitor questions \/ requests/);
    assert.doesNotMatch(bodies(bundle), /Quote requested|Quote request\n|quote discussion needed|Specialty items/);
});

test('unavailable capture produces an honest notice and never reparses old transcript facts', () => {
    const turns = [user('My name is Old Identity. I have a piano and a sofa. My phone is 602-555-0123.')];
    for (const extra of [{ captureStatus: 'unavailable' }, { captureStatus: 'ready' }]) {
        const bundle = bundleFor(turns, undefined, extra);
        assert.deepEqual(bundle.intake.inventory, []);
        assert.deepEqual(bundle.intake.originDestination, []);
        assert.deepEqual(bundle.intake.propertyScope, []);
        assert.doesNotMatch(bodies(bundle), /Old Identity|Previous Name|piano|sofa|602-555-0123/);
        for (const audience of ['visitor', 'sales', 'admin']) assert.match(bundle[audience].text, /structured move summary is unavailable/);
        assert.match(bundle.admin.attachments[0].content, /piano and a sofa/);
        assert.doesNotMatch(bundle.admin.attachments[0].content, /602-555-0123/);
        assert.match(bundle.sales.text, /verified@example\.test/);
    }
    const record = capture(turns, [fact('inventory', 'piano', 0, turns[0].content)]);
    assert.deepEqual(bundleFor(turns, record, { captureStatus: 'unavailable' }).intake.inventory, []);
});

test('guest internal brief uses the same current record and does not revive stale confirmed lead fields', () => {
    const turns = [user('You can call me Jo. I have two armoires. My phone is 602-555-0199.'), user('Please remove my email.')];
    const record = capture(turns, [fact('name', 'Jo', 0, turns[0].content), fact('inventory', 'armoires', 0, turns[0].content, { quantity: 'two' }),
        fact('phone', '602-555-0199', 0, turns[0].content), fact('email', 'email', 1, turns[1].content, { status: 'removed' })]);
    const brief = buildEvanGuestLeadBrief({ externalSessionId: 'guest-capture', lead: oldLead, turns, captureRecord: record });
    assert.match(brief.text, /Name shared, verify before follow-up: Jo/);
    assert.match(brief.text, /Phone shared, verify before follow-up: \(602\) 555-0199/);
    assert.match(brief.text, /two armoires/);
    assert.doesNotMatch(brief.text + brief.html + brief.subject, /Previous Name|Stale Review|old@example\.test|6025550123|read back and confirmed/);
    assert.equal(brief.attachments.length, 1);
    assert.doesNotMatch(brief.attachments[0].content, /602-555-0199/);
    const unavailable = buildEvanGuestLeadBrief({ externalSessionId: 'guest-capture', lead: oldLead, turns, captureRecord: record, captureStatus: 'unavailable' });
    assert.match(unavailable.text, /structured move summary is unavailable/);
    assert.doesNotMatch(unavailable.text + unavailable.html, /two armoires|Previous Name|6025550123/);
});

test('sanitized attachment preserves all 400 bounded turns and late corrections without contact leakage', () => {
    const turns = Array.from({ length: 400 }, (_, index) => user(`Discussion turn ${index + 1}.`));
    turns[210] = user('My phone is 6025550123. My email is jo at example dot test.');
    turns[260] = user('The phone is six zero two five five five zero one nine nine.');
    turns[320] = user('Spelled email j o a n at example dot test.');
    turns[370] = user('Move detail. '.repeat(210) + 'A correction near the end of a long turn remains available.');
    turns[399] = user('Final correction: remove the piano, keep the credenza.');
    const redacted = redactEvanTranscript(turns);
    assert.equal(redacted.length, 400);
    assert.match(redacted[399].content, /Final correction/);
    assert.match(redacted[370].content, /correction near the end of a long turn remains available/);
    const joined = redacted.map(turn => turn.content).join('\n');
    assert.doesNotMatch(joined, /6025550123|jo at example dot test|six zero two five five five zero one nine nine|j o a n at example dot test/);
    assert.equal((joined.match(/\[private contact\]/g) ?? []).length, 4);
    const bundle = bundleFor(turns, capture(turns, []));
    assert.match(bundle.admin.attachments[0].content, /400\. VISITOR: Final correction/);
    assert.match(bundle.admin.text, /Visitor \/ Evan turns: 400 \/ 0/);
    assert.doesNotMatch(bundle.admin.attachments[0].content, /6025550123|jo at example dot test/);
});

test('capture HTML escapes quoted markup and all inventory items survive beyond legacy eight-item limit', () => {
    const itemNames = Array.from({ length: 12 }, (_, index) => `custom crate ${index + 1}`);
    const turns = [user(`I have ${itemNames.join(', ')}. The label is <script>alert(1)</script>.`)];
    const record = capture(turns, [...itemNames.map(value => fact('inventory', value, 0, turns[0].content)),
        fact('care', '<script>alert(1)</script>', 0, turns[0].content)]);
    const bundle = bundleFor(turns, record);
    for (const audience of ['visitor', 'admin', 'sales']) {
        assert.ok(bundle[audience].text.includes('custom crate 12'));
        assert.doesNotMatch(bundle[audience].html, /<script>/);
        assert.match(bundle[audience].html, /&lt;script&gt;/);
    }
});

test('legacy callers without capture options retain legacy intake semantics', () => {
    const turns = [user('I have a piano. Remove the piano.')];
    const bundle = bundleFor(turns);
    assert.deepEqual(bundle.intake, buildEvanMovingIntake(redactEvanTranscript(turns)));
    assert.match(bundle.sales.text, /Specialty \/ high-care items/);
    assert.match(bundle.sales.text, /Authorized callback/);
});
