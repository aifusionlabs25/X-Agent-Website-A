import assert from 'node:assert/strict';
import test from 'node:test';
import { buildJamesEmailTemplates } from '../lib/james-canary/email-templates.ts';

const fixture = () => ({
    sections: [
        { title: 'Client', items: [{ label: 'Full name', text: 'Michael Carter' },
            { label: 'Callback number', text: '602-555-0138' }, { label: 'Email', text: 'michael.carter@email.com' }] },
        { title: 'Matter', items: [{ label: 'Reason for contacting', text: 'Vehicle collision in Mesa' },
            { label: 'Reported circumstances', text: 'I was stopped at the light. I was not at work.' },
            { label: 'Principal concern', text: 'I do not know which insurer to contact.' },
            { label: 'Requested help', text: 'An initial conversation, not an appointment.' }] },
        { title: 'Timing & location', items: [{ label: 'Reported location', text: 'Mesa' },
            { label: 'Incident / matter timing', text: 'Yesterday (unconfirmed)' }] },
        { title: 'Additional context', items: [{ label: 'Documents / evidence', text: 'Photographs' },
            { label: 'Injury / care reported', text: 'Not known by the visitor' },
            { label: 'Questions for attorney review', text: 'What should I have ready?' }] },
    ],
    sessionId: 'website-session-123', providerId: 'provider-session-456',
    providerStartedAt: '2026-10-13T17:00:00.000Z', providerEndedAt: '2026-10-13T17:04:18.000Z',
    transcriptHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64),
    transcriptFilename: 'james-website-session-123-transcript.txt', turnCount: 10,
    generatedAt: '2026-10-13T17:05:00.000Z',
});
const escape = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const row = (input, section, label) => input.sections.find(s => s.title === section).items.find(item => item.label === label);

test('returns three independent multipart templates with static safe subjects', () => {
    const result = buildJamesEmailTemplates(fixture());
    assert.deepEqual(Object.keys(result), ['caller', 'internal', 'admin']);
    for (const content of Object.values(result)) {
        assert.deepEqual(Object.keys(content), ['subject', 'text', 'html']);
        assert.ok(content.subject.length <= 200);
        assert.doesNotMatch(content.subject, /[\r\n]/u);
        assert.ok(content.text.length <= 30_000);
        assert.ok(content.html.length <= 90_000);
        assert.match(content.html, /^<!doctype html>/u);
    }
});

test('caller uses own structured name and only five relevant exact matter bullets', () => {
    const input = fixture();
    const result = buildJamesEmailTemplates(input);
    assert.match(result.caller.text, /Thank you, Michael\./u);
    assert.equal((result.caller.text.match(/^• /gmu) || []).length, 5);
    for (const label of ['Reason for contacting', 'Principal concern', 'Requested help', 'Reported location', 'Incident / matter timing']) {
        const item = input.sections.flatMap(s => s.items).find(item => item.label === label);
        assert.ok(result.caller.text.includes(`${item.label}: ${item.text}`));
        assert.ok(result.caller.html.includes(escape(item.text)));
    }
    assert.doesNotMatch(result.caller.text, /602-555-0138|michael\.carter@email\.com|Reported circumstances|Documents \/ evidence/u);
    assert.match(result.caller.text, /No appointment or response time has been confirmed/u);
    assert.doesNotMatch(result.caller.text, /someone will contact|we will call|scheduled|representation has been accepted/iu);
});

test('firm preserves every source section and row including uncertainty and negation', () => {
    const input = fixture();
    const result = buildJamesEmailTemplates(input).internal;
    for (const section of input.sections) {
        assert.ok(result.text.includes(section.title));
        assert.ok(result.html.includes(escape(section.title)));
        for (const item of section.items) {
            assert.ok(result.text.includes(`${item.label}: ${item.text}`));
            assert.ok(result.html.includes(escape(item.label)));
            assert.ok(result.html.includes(escape(item.text)));
        }
    }
    assert.match(result.text, /I was not at work/u);
    assert.match(result.text, /Not known by the visitor/u);
    assert.match(result.text, /Yesterday \(unconfirmed\)/u);
    assert.match(result.text, /Verified transcript attached: james-website-session-123-transcript\.txt \(10 turns\)/u);
    assert.match(result.text, /Reference website-session-123/u);
});

test('admin reflects actual Phoenix date, provider duration and all supplied identifiers', () => {
    const input = fixture();
    const result = buildJamesEmailTemplates(input).admin;
    assert.match(result.text, /Date: October 13, 2026/u);
    assert.match(result.text, /Provider started: October 13, 2026 at 10:00:00/u);
    assert.match(result.text, /Provider ended: October 13, 2026 at 10:04:18/u);
    assert.match(result.text, /Duration: 4 minutes, 18 seconds/u);
    assert.match(result.text, /Record generated: October 13, 2026 at 10:05:00/u);
    for (const key of ['sessionId', 'providerId', 'transcriptHash', 'snapshotHash', 'transcriptFilename']) {
        assert.ok(result.text.includes(input[key]));
        assert.ok(result.html.includes(escape(input[key])));
    }
    assert.match(result.text, /Transcript turns: 10/u);
    assert.match(result.text, /America\/Phoenix · UTC−07:00/u);
    assert.match(result.text, /Search terms from the brief\n\nVehicle collision in Mesa/u);
    assert.doesNotMatch(result.text, /michael\.carter@email|602-555-0138|Identity verified|IP collected|DELIVERY STATUS|provider receipt/iu);
});

test('Phoenix date is not the UTC date near midnight', () => {
    const input = fixture();
    input.providerStartedAt = '2026-10-14T00:00:00Z';
    input.providerEndedAt = '2026-10-14T00:01:01Z';
    input.generatedAt = '2026-10-14T00:01:02Z';
    const result = buildJamesEmailTemplates(input).admin;
    assert.match(result.text, /Date: October 13, 2026/u);
    assert.match(result.text, /17:00:00/u);
    assert.match(result.text, /Duration: 1 minute, 1 second/u);
});

for (const [label, start, end, expected] of [
    ['unknown', undefined, '2026-10-13T17:04:18Z', 'Not available'],
    ['empty', '', '2026-10-13T17:04:18Z', 'Not available'],
    ['reversed', '2026-10-13T17:05:00Z', '2026-10-13T17:04:18Z', 'Not available'],
    ['zero', '2026-10-13T17:00:00Z', '2026-10-13T17:00:00Z', '0 seconds'],
    ['hour', '2026-10-13T17:00:00Z', '2026-10-13T18:01:01Z', '1 hour, 1 minute, 1 second'],
]) test(`duration ${label} uses only provider start and end`, () => {
    const input = fixture();
    input.providerStartedAt = start;
    input.providerEndedAt = end;
    assert.ok(buildJamesEmailTemplates(input).admin.text.includes(`Duration: ${expected}`));
});

for (const name of ['Not yet provided', 'Visitor declined', 'Not known by the visitor', 'Michael Carter (unconfirmed)', '<img src=x onerror=alert(1)>', 'Michael\nBcc: intruder@example.com']) {
    test(`unsafe or unavailable greeting is generic: ${JSON.stringify(name)}`, () => {
        const input = fixture();
        row(input, 'Client', 'Full name').text = name;
        const result = buildJamesEmailTemplates(input);
        assert.match(result.caller.text, /Thank you for speaking with James\./u);
        assert.doesNotMatch(result.caller.html, /<img|Bcc:/u);
    });
}

test('only Full name in Client controls greeting, never another person or address', () => {
    const input = fixture();
    input.sections[0].items = input.sections[0].items.filter(item => item.label !== 'Full name');
    input.sections[1].items.push({ label: 'Full name', text: 'Another Person' });
    const result = buildJamesEmailTemplates(input);
    assert.match(result.caller.text, /Thank you for speaking with James\./u);
    assert.doesNotMatch(result.caller.text, /Thank you, Another|Thank you, michael/iu);
});

test('Unicode names, apostrophes and exact non-English source facts survive rendering', () => {
    const input = fixture();
    row(input, 'Client', 'Full name').text = 'Élodie O’Neill';
    row(input, 'Matter', 'Reason for contacting').text = 'Revisión de daño · 東京 · café & té';
    const result = buildJamesEmailTemplates(input);
    assert.match(result.caller.text, /Thank you, Élodie\./u);
    assert.ok(result.internal.text.includes('Élodie O’Neill'));
    assert.ok(result.caller.html.includes('Revisión de daño · 東京 · café &amp; té'));
});

test('Client label and title lookup is case insensitive', () => {
    const input = fixture();
    input.sections[0].title = 'CLIENT';
    input.sections[0].items[0].label = 'FULL NAME';
    assert.match(buildJamesEmailTemplates(input).caller.text, /Thank you, Michael\./u);
});

test('sparse inputs render no invented matter, name, provider ID or duration', () => {
    const input = fixture();
    input.sections = [];
    delete input.providerId;
    delete input.providerStartedAt;
    input.turnCount = 0;
    const result = buildJamesEmailTemplates(input);
    assert.match(result.caller.text, /No matter details were captured/u);
    assert.equal((result.caller.text.match(/^• /gmu) || []).length, 0);
    assert.match(result.internal.text, /New conversation/u);
    assert.match(result.admin.text, /Provider session: Not available/u);
    assert.match(result.admin.text, /Duration: Not available/u);
    assert.match(result.admin.text, /Transcript turns: 0/u);
    assert.doesNotMatch(Object.values(result).map(value => value.text).join('\n'), /Avery|Stone|Mesa|602-/u);
});

test('unknown rows never masquerade as a known matter in caller or TLDR', () => {
    const input = fixture();
    input.sections = [{ title: 'Matter', items: [{ label: 'Requested help', text: 'Visitor declined' },
        { label: 'Reason for contacting', text: 'Not yet provided' }] }];
    const result = buildJamesEmailTemplates(input);
    assert.doesNotMatch(result.caller.text, /^• /gmu);
    assert.match(result.internal.text, /TL;DR\nNo matter details were captured/u);
    assert.match(result.internal.text, /Requested help: Visitor declined/u);
});

test('duplicate source facts are selected once in caller but all firm rows are retained', () => {
    const input = fixture();
    row(input, 'Matter', 'Principal concern').text = row(input, 'Matter', 'Reason for contacting').text;
    const result = buildJamesEmailTemplates(input);
    assert.equal(result.caller.text.split('Vehicle collision in Mesa').length - 1, 1);
    assert.match(result.internal.text, /Principal concern: Vehicle collision in Mesa/u);
});

test('all dynamic HTML contexts escape markup, quotes, ampersands and row line breaks', () => {
    const attack = '<script>alert("x")</script> & \'single\' <img src=x onerror=alert(1)>';
    const input = fixture();
    input.sections = [{ title: attack, items: [{ label: attack, text: `${attack}\nSecond line` }] }];
    input.sessionId = attack;
    input.providerId = attack;
    input.transcriptHash = attack;
    input.snapshotHash = attack;
    input.transcriptFilename = attack;
    const result = buildJamesEmailTemplates(input);
    for (const content of Object.values(result)) {
        assert.doesNotMatch(content.html, /<script|<img|<[^>]+\bonerror\s*=/iu);
        assert.ok(content.html.includes(escape(attack)));
        assert.doesNotMatch(content.html, /<a |javascript:|<iframe|<link/u);
    }
    assert.ok(result.internal.text.includes(`${attack}\nSecond line`));
});

test('brand, demo contact and accuracy boundary are present in every HTML/text twin', () => {
    const result = buildJamesEmailTemplates(fixture());
    for (const content of Object.values(result)) {
        for (const field of ['text', 'html']) {
            assert.match(content[field], /For demo purposes only\./u);
            assert.match(content[field], /James is an AI agent and can make mistakes/u);
            assert.match(content[field], /Please verify important information/u);
            assert.match(content[field], /not confirmation of representation or firm acceptance/u);
            assert.doesNotMatch(content[field], /Local design preview|No provider receipts|No email sent|delivered|Successfully sent|Avery Stone|james@knowleslawfirm|appointment is scheduled/iu);
        }
        assert.match(content.html, /KNOWLES<\/p>/u);
        assert.match(content.html, /LAW FIRM<\/p>/u);
    }
});

test('email layout uses compatible inline tables and a narrow-screen fallback without remote assets', () => {
    for (const content of Object.values(buildJamesEmailTemplates(fixture()))) {
        assert.match(content.html, /role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"/u);
        assert.match(content.html, /max-width:640px;background:#fffdf7/u);
        assert.match(content.html, /background:#172329/u);
        assert.match(content.html, /background:#af8952/u);
        assert.match(content.html, /\[if mso\]/u);
        assert.match(content.html, /@media\(max-width:540px\)/u);
        assert.match(content.html, /overflow-wrap:anywhere/u);
        assert.doesNotMatch(content.html, /https?:|@import|<script|<iframe|<img|display:grid|display:flex/u);
        assert.equal((content.html.match(/<table\b/gu) || []).length, (content.html.match(/<\/table>/gu) || []).length);
    }
});

test('input is never mutated and rendering is deterministic', () => {
    const input = fixture();
    const before = JSON.stringify(input);
    assert.deepEqual(buildJamesEmailTemplates(input), buildJamesEmailTemplates(input));
    assert.equal(JSON.stringify(input), before);
});

for (const [label, mutate] of [
    ['section count', input => input.sections = Array.from({ length: 25 }, () => ({ title: 'Matter', items: [] }))],
    ['row count', input => input.sections = [{ title: 'Matter', items: Array.from({ length: 121 }, () => ({ label: 'Fact', text: 'A fact' })) }]],
    ['row text', input => row(input, 'Matter', 'Reason for contacting').text = 'x'.repeat(4001)],
    ['total source', input => input.sections = [{ title: 'Matter', items: Array.from({ length: 7 }, () => ({ label: 'Fact', text: 'x'.repeat(4000) })) }]],
    ['row label', input => row(input, 'Matter', 'Reason for contacting').label = 'x'.repeat(161)],
    ['section title', input => input.sections[0].title = 'x'.repeat(161)],
    ['session ID', input => input.sessionId = 'x'.repeat(181)],
    ['metadata newlines', input => input.transcriptFilename = 'safe.txt\nBcc: someone@example.com'],
    ['control character', input => row(input, 'Matter', 'Reason for contacting').text = 'hidden\u0000value'],
    ['negative turns', input => input.turnCount = -1],
    ['fractional turns', input => input.turnCount = 1.2],
    ['missing ended', input => delete input.providerEndedAt],
    ['timezone-less end', input => input.providerEndedAt = '2026-10-13T17:04:18'],
    ['invalid generated date', input => input.generatedAt = 'no date'],
    ['impossible calendar date', input => input.generatedAt = '2026-02-30T17:00:00Z'],
    ['impossible clock time', input => input.generatedAt = '2026-10-13T25:00:00Z'],
    ['invalid provider start', input => input.providerStartedAt = 'not a timestamp'],
    ['non-array sections', input => input.sections = null],
    ['non-string text', input => row(input, 'Matter', 'Reason for contacting').text = { text: 'unsafe' }],
]) test(`fails closed for ${label}, without truncating input`, () => {
    const input = fixture();
    mutate(input);
    const before = JSON.stringify(input);
    assert.throws(() => buildJamesEmailTemplates(input), /Invalid|Oversized/u);
    assert.equal(JSON.stringify(input), before);
});

test('HTML expansion cap fails closed even when raw source fits its bound', () => {
    const input = fixture();
    input.sections = [{ title: 'Matter', items: Array.from({ length: 6 }, (_, index) => ({ label: `Fact ${index}`, text: '"'.repeat(3900) })) }];
    assert.throws(() => buildJamesEmailTemplates(input), /Oversized James email output/u);
});
