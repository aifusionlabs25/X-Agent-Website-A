import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  clearStoredMeetingConciergeInvite,
  detectMeetingConciergeProvider,
  readStoredMeetingConciergeInvite,
  storeMeetingConciergeInvite,
} from '../lib/meeting-concierge/v1/client.ts';
import { createMeetingPersonaSnapshot } from '../lib/meeting-concierge/v1/persona-snapshot.ts';
import {
  issueMeetingConciergeStatusTicket,
  readMeetingConciergeStatusTicket,
} from '../lib/meeting-concierge/v1/tickets.ts';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const sharedFiles = [
  'lib/meeting-concierge/v1/contracts.ts',
  'lib/meeting-concierge/v1/client.ts',
  'lib/meeting-concierge/v1/server.ts',
  'lib/meeting-concierge/v1/tickets.ts',
  'lib/meeting-concierge/v1/persona-snapshot.ts',
  'components/meeting-concierge/v1/MeetingConcierge.tsx',
];
const amyFiles = [
  'lib/meeting-concierge/v1/adapters/amy-client.ts',
  'app/api/anam/amy/meetings/route.ts',
  'components/amy/AmyMeetingScheduler.tsx',
  'components/amy/AmyMeetingScheduler.module.css',
];
const daniFiles = [
  'lib/meeting-concierge/v1/adapters/dani-client.ts',
  'app/api/anam/dani/meetings/route.ts',
  'components/dani/DaniMeetingScheduler.tsx',
  'components/dani/DaniMeetingScheduler.module.css',
];
const evanFiles = [
  'lib/meeting-concierge/v1/adapters/evan-client.ts',
  'app/api/anam/evan/meetings/route.ts',
  'components/evan/EvanMeetingScheduler.tsx',
  'components/evan/EvanMeetingScheduler.module.css',
];

test('v1 shared core stays agent-neutral', () => {
  for (const path of sharedFiles) {
    const source = read(path);
    assert.doesNotMatch(source, /\bAmy\b|\bDani\b|\bEvan\b|\/amy(?:\/|['"?])|\/dani(?:\/|['"?])|\/evan(?:\/|['"?])|DANI_|AMY_|EVAN_/i, `${path} must not contain agent-specific behavior`);
  }
  assert.match(read('lib/meeting-concierge/v1/contracts.ts'), /MEETING_CONCIERGE_VERSION\s*=\s*['"]v1['"]/);
  assert.match(read('components/meeting-concierge/v1/MeetingConcierge.tsx'), /data-meeting-concierge-version=\{MEETING_CONCIERGE_VERSION\}/);
});

test('Amy adapter uses only Amy identity, consent, persona, and routes', () => {
  const combined = amyFiles.map(read).join('\n');
  assert.doesNotMatch(combined, /Dani|DANI_|\/dani(?:\/|['"?])|readDani|dani_/i);

  const client = read(amyFiles[0]);
  assert.match(client, /meetingApiPath:\s*['"]\/api\/anam\/amy\/meetings['"]/);
  assert.match(client, /returnHref:\s*['"]\/agents\/amy['"]/);
  assert.match(client, /fetch\(['"]\/api\/anam\/amy\/access['"]/);
  assert.match(client, /body:\s*JSON\.stringify\(fields\)/);
  assert.match(client, /Meeting transcripts, recaps, and returning memory are not included in Meeting Concierge v1/);
  assert.doesNotMatch(client, /standard session follow-up/);

  const route = read(amyFiles[1]);
  assert.match(route, /ANAM_AMY_CARA4_PERSONA_ID/);
  assert.match(route, /resolveAnamSessionPersona/);
  assert.match(route, /contact\?\.purpose\s*!==\s*['"]amy_follow_up['"]/);
  assert.match(route, /readAmyAnamBrowserIdentity\(browser\.id\)/);
  assert.match(route, /removeToolNames:\s*\[['"]end_amy_session['"]\]/);
  assert.match(route, /addToolNames:\s*\[['"]end_call['"]\]/);
  assert.match(route, /Call end_call once with confirmed true/i);
  assert.match(route, /export const DELETE = amyMeetingConcierge\.DELETE/);
  assert.doesNotMatch(route, /personaId:\s*['"][0-9a-f-]{36}['"]/i, 'persona IDs must be resolved, never hardcoded');
  assert.doesNotMatch(route, /agentmail|resend|sendEmail/i, 'Meeting Concierge must not alter AgentMail delivery');
});

test('Dani adapter uses only Dani identity, consent, persona, and routes', () => {
  const combined = daniFiles.map(read).join('\n');
  assert.doesNotMatch(combined, /\bAmy\b|AMY_|\/amy(?:\/|['"?])|readAmyAnamBrowserIdentity|amy_follow_up/i);

  const client = read(daniFiles[0]);
  assert.match(client, /meetingApiPath:\s*['"]\/api\/anam\/dani\/meetings['"]/);
  assert.match(client, /returnHref:\s*['"]\/agents\/dani['"]/);
  assert.match(client, /kind:\s*['"]email-code['"]/);
  assert.match(client, /fetch\(['"]\/api\/anam\/dani\/access['"]/);
  assert.match(client, /fetch\(['"]\/api\/anam\/dani\/access\/verify['"]/);
  assert.match(client, /followUpConsent:\s*true/);
  assert.match(client, /memoryConsent:\s*false/);
  assert.match(client, /defaultMode:\s*['"]observer['"]/);
  assert.match(client, /mode:\s*['"]observer['"][\s\S]*mode:\s*['"]participant['"][\s\S]*mode:\s*['"]facilitator['"]/);
  assert.match(client, /Meeting transcripts, recaps, and returning memory are not included in Meeting Concierge v1/);
  assert.doesNotMatch(client, /standard meeting follow-up/);

  const route = read(daniFiles[1]);
  assert.match(route, /expectedPersonaId:\s*DANI_PERSONA_ID/);
  assert.match(route, /storedContact\?\.purpose\s*!==\s*['"]dani_follow_up['"]/);
  assert.match(route, /emailOwnershipVerified\s*!==\s*true/);
  assert.match(route, /removeToolNames:\s*\[[\s\S]*['"]end_dani_session['"][\s\S]*['"]send_dani_follow_up_email['"][\s\S]*['"]confirm_dani_live_identity['"]/);
  assert.match(route, /addToolNames:\s*\[['"]end_call['"]\]/);
  assert.match(route, /Call end_call once with confirmed true/i);
  assert.match(route, /buildDaniMeetingParticipationPrompt/);
  assert.match(route, /applyDaniMeetingVoiceProfile/);
  assert.match(route, /export const DELETE = daniMeetingConcierge\.DELETE/);
  assert.doesNotMatch(route, /personaId:\s*['"][0-9a-f-]{36}['"]/i, 'persona IDs must be imported, never hardcoded');
  assert.doesNotMatch(route, /sendEmail|resend/i, 'Meeting Concierge must not alter email delivery');
});

test('Evan adapter uses only Evan identity, consent, persona, and routes', () => {
  const combined = evanFiles.map(read).join('\n');
  assert.doesNotMatch(combined, /\bDani\b|DANI_|\/amy(?:\/|['"?])|\/dani(?:\/|['"?])|amy_follow_up|dani_follow_up/i);

  const client = read(evanFiles[0]);
  assert.match(client, /meetingApiPath:\s*['"]\/api\/anam\/evan\/meetings['"]/);
  assert.match(client, /returnHref:\s*['"]\/agents\/evan['"]/);
  assert.match(client, /kind:\s*['"]contact['"]/);
  assert.match(client, /fetch\(['"]\/api\/anam\/evan\/access['"]/);
  assert.match(client, /followUpConsent:\s*true/);
  assert.match(client, /Meeting transcripts, recap emails, and returning memory are not included in Meeting Concierge v1/);

  const route = read(evanFiles[1]);
  assert.match(route, /expectedPersonaId:\s*EVAN_PERSONA_ID/);
  assert.match(route, /contact\?\.purpose\s*!==\s*['"]evan_follow_up['"]/);
  assert.match(route, /removeToolNames:\s*\[[\s\S]*['"]end_mullins_session['"][\s\S]*['"]send_mullins_follow_up_email['"][\s\S]*['"]show_move_planner['"]/);
  assert.match(route, /addToolNames:\s*\[['"]end_call['"]\]/);
  assert.match(route, /Call end_call once with confirmed true/i);
  assert.match(route, /export const DELETE = evanMeetingConcierge\.DELETE/);
  assert.doesNotMatch(route, /personaId:\s*['"][0-9a-f-]{36}['"]/i, 'persona IDs must be imported, never hardcoded');
  assert.doesNotMatch(route, /agentmail|resend|sendEmail/i, 'Meeting Concierge must not alter email delivery');
});

test('three-agent adapters remain isolated while sharing one versioned core', () => {
  const amy = amyFiles.map(read).join('\n');
  const dani = daniFiles.map(read).join('\n');
  const evan = evanFiles.map(read).join('\n');
  assert.doesNotMatch(amy, /Dani|DANI_|\/dani(?:\/|['"?])|dani_follow_up/i);
  assert.doesNotMatch(dani, /\bAmy\b|AMY_|\/amy(?:\/|['"?])|amy_follow_up/i);
  assert.doesNotMatch(evan, /\bDani\b|DANI_|\/amy(?:\/|['"?])|\/dani(?:\/|['"?])|amy_follow_up|dani_follow_up/i);
  assert.match(read('components/amy/AmyMeetingScheduler.tsx'), /<MeetingConcierge/);
  assert.match(read('components/dani/DaniMeetingScheduler.tsx'), /<MeetingConcierge/);
  assert.match(read('components/evan/EvanMeetingScheduler.tsx'), /<MeetingConcierge/);
  assert.match(read('lib/meeting-concierge/v1/contracts.ts'), /kind:\s*['"]credentials['"]/);
  assert.match(read('lib/meeting-concierge/v1/contracts.ts'), /kind:\s*['"]email-code['"]/);
  assert.match(read('lib/meeting-concierge/v1/contracts.ts'), /kind:\s*['"]contact['"]/);
  assert.match(read('lib/meeting-concierge/v1/contracts.ts'), /MEETING_CONCIERGE_PARTICIPATION_MODES\s*=\s*\[['"]observer['"], ['"]participant['"], ['"]facilitator['"]\]/);
});

test('status tickets are signed and bound to the agent and organizer', () => {
  const server = read('lib/meeting-concierge/v1/server.ts');
  const tickets = read('lib/meeting-concierge/v1/tickets.ts');
  assert.match(tickets, /createHmac\(['"]sha256['"], scope\.secret\)/);
  assert.match(tickets, /agent:\s*scope\.agentKey/);
  assert.match(tickets, /organizer:\s*organizerDigest\(scope\.isolationId\)/);
  assert.match(tickets, /record\.agent\s*!==\s*scope\.agentKey/);
  assert.match(tickets, /record\.organizer\s*!==\s*organizerDigest\(scope\.isolationId\)/);
  assert.match(server, /id:\s*issueMeetingConciergeStatusTicket\(/);
  assert.match(server, /readMeetingConciergeStatusTicket\(/);
  assert.match(server, /const DELETE = async \(request: Request\)/);
  assert.match(server, /method:\s*['"]DELETE['"]/);
  assert.match(server, /meeting-remove:\$\{organizer\.isolationId\}/);
  assert.match(
    server,
    /adapter\.platform\.consumeRateLimit\([\s\S]*const inviteId = new URL\(request\.url\)[\s\S]*if \(!inviteId\)[\s\S]*adapter\.readOrganizer\(request\)/,
    'status requests are rate-limited before every organizer-store lookup',
  );
  assert.match(
    server,
    /const origin = request\.headers\.get\(['"]origin['"]\);[\s\S]*if \(origin && !adapter\.platform\.isTrustedBrowserOrigin\(request\)\)/,
    'read-only status requests accept a missing Origin header while rejecting an explicitly untrusted origin',
  );
});

test('meeting-scoped persona snapshot preserves identity and swaps only the close tool', () => {
  const oldCloseId = '123e4567-e89b-42d3-a456-426614174000';
  const knowledgeId = '123e4567-e89b-42d3-a456-426614174001';
  const meetingCloseId = '123e4567-e89b-42d3-a456-426614174002';
  const personaId = '123e4567-e89b-42d3-a456-426614174003';
  const snapshot = createMeetingPersonaSnapshot({
    expectedPersonaId: personaId,
    persona: {
      id: personaId,
      name: 'Reference Agent',
      avatar: { id: '123e4567-e89b-42d3-a456-426614174004' },
      voice: { id: '123e4567-e89b-42d3-a456-426614174005' },
      llmId: '123e4567-e89b-42d3-a456-426614174006',
      brain: { systemPrompt: 'Base behavior', personality: 'Warm' },
      tools: [
        { id: oldCloseId, name: 'end_agent_session', type: 'CLIENT' },
        { id: knowledgeId, name: 'agent_knowledge', type: 'SERVER_RAG' },
      ],
      initialMessage: 'Hello',
      voiceSpeed: 1,
      zeroDataRetention: false,
    },
    availableTools: [{ id: meetingCloseId, name: 'end_call', type: 'SYSTEM' }],
    removeToolNames: ['end_agent_session'],
    addToolNames: ['end_call'],
    addToolTypes: { end_call: 'SYSTEM' },
    systemPromptSuffix: 'Meeting-only behavior',
    maxSessionLengthSeconds: 1_800,
  });
  assert.equal(snapshot.avatarId, '123e4567-e89b-42d3-a456-426614174004');
  assert.equal(snapshot.voiceId, '123e4567-e89b-42d3-a456-426614174005');
  assert.equal(snapshot.llmId, '123e4567-e89b-42d3-a456-426614174006');
  assert.deepEqual(snapshot.toolIds, [knowledgeId, meetingCloseId]);
  assert.equal(snapshot.maxSessionLengthSeconds, 1_800);
  assert.match(snapshot.systemPrompt, /^Base behavior[\s\S]*Meeting-only behavior$/);
  assert.equal(snapshot.initialMessage, 'Hello');
});

test('browser meeting control is namespaced by agent and restores only bounded records', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const state = {
    invite: { id: 'opaque.signed.ticket.value', provider: 'microsoft_teams', status: 'active', joinAt: null, joinState: 'media_active', sessionId: null, statusReason: null },
    provider: 'teams',
    groupCall: true,
    maxDurationMinutes: 30,
    savedAt: Date.now(),
  };
  storeMeetingConciergeInvite('agent-a', state, storage);
  assert.deepEqual(readStoredMeetingConciergeInvite('agent-a', storage), state);
  assert.equal(readStoredMeetingConciergeInvite('agent-b', storage), null);
  clearStoredMeetingConciergeInvite('agent-a', storage);
  assert.equal(readStoredMeetingConciergeInvite('agent-a', storage), null);
});

test('a status ticket cannot cross an organizer boundary', async () => {
  const providerInviteId = '123e4567-e89b-42d3-a456-426614174000';
  const owner = {
    agentKey: 'test-agent',
    isolationId: 'organizer-a',
    secret: 'a-test-secret-that-is-long-enough-for-hmac',
  };
  const ticket = issueMeetingConciergeStatusTicket({ ...owner, inviteId: providerInviteId });
  assert.notEqual(ticket, providerInviteId, 'the browser receives an opaque status ticket, not the provider ID');
  assert.equal(readMeetingConciergeStatusTicket({ ...owner, ticket }), providerInviteId);
  assert.throws(
    () => readMeetingConciergeStatusTicket({ ...owner, isolationId: 'organizer-b', ticket }),
    error => error?.status === 403 && /not available to this organizer/i.test(error.message),
  );
  assert.throws(
    () => readMeetingConciergeStatusTicket({ ...owner, agentKey: 'another-agent', ticket }),
    error => error?.status === 403,
  );
});

test('provider detection accepts only supported meeting hosts', () => {
  assert.equal(detectMeetingConciergeProvider('https://meet.google.com/abc-defg-hij'), 'google');
  assert.equal(detectMeetingConciergeProvider('https://acme.zoom.us/j/123'), 'zoom');
  assert.equal(detectMeetingConciergeProvider('https://teams.microsoft.com/l/meetup-join/abc'), 'teams');
  assert.equal(detectMeetingConciergeProvider('https://example.com/zoom.us/j/123'), null);
  assert.equal(detectMeetingConciergeProvider('not a url'), null);
});

test('Amy entry preserves the regular session and adds explicit concierge routing', () => {
  const route = read('app/agents/[slug]/page.tsx');
  const landing = read('components/agents/AmyInsightLanding.tsx');
  const agents = read('lib/agents.ts');
  assert.match(route, /agent\.slug === ['"]amy['"][\s\S]*rawMeetingProvider[\s\S]*<AmyMeetingConcierge/);
  assert.match(route, /if \(meetingProvider\) return <AmyMeetingConcierge initialProvider=\{meetingProvider\}/);
  assert.match(route, /return <AmyInsightLanding \/>/);
  assert.match(landing, /href=['"]\/agents\/amy\?meeting=google['"]/);
  assert.match(landing, /Invite Amy to a meeting/);
  assert.match(agents, /slug:\s*['"]amy['"][\s\S]*liveUrl:\s*['"]\/demo\/amy\?variant=cara4['"]/);
});

test('Amy brand shell implements the full shared style contract', () => {
  const component = read('components/amy/AmyMeetingScheduler.tsx');
  const css = read('components/amy/AmyMeetingScheduler.module.css');
  assert.match(component, /amy-insight-sdr-hero-polished\.webp/);
  assert.match(component, /insight-logo\.png/);
  assert.match(component, /className=\{styles\.schedulerPanel\}>\s*<Image[\s\S]{0,220}insight-logo\.png/);
  assert.match(component, /data-amy-surface=['"]meeting-concierge['"]/);
  const required = [
    'scheduler', 'backLink', 'topline', 'headingRow', 'eyebrow', 'title', 'steps',
    'formStack', 'providerGrid', 'timingGrid', 'fieldGrid', 'joinNowNote', 'roleGrid',
    'optional', 'note', 'reviewCard', 'purposeReview', 'verifiedCard', 'verifyPanel',
    'sectionTitle', 'sectionCopy', 'fieldGridTwo', 'memoryChoice', 'verifyButton',
    'spinner', 'consentCopy', 'error', 'actions', 'secondaryButton', 'primaryButton',
    'platformMark', 'googleMark', 'zoomMark', 'teamsMark', 'confirmIcon', 'intro',
    'liveStatus', 'confirmFacts',
    'durationGrid', 'dangerButton', 'dangerPanel', 'restoredNote',
  ];
  for (const className of required) assert.match(css, new RegExp(`\\.${className}(?:\\s|,|\\{|:)`), `missing .${className}`);
  const logoRule = css.match(/\.logo\s*\{[^}]*\}/s)?.[0] ?? '';
  assert.match(logoRule, /right:\s*clamp\(/);
  assert.match(logoRule, /background:\s*transparent/);
  assert.doesNotMatch(logoRule, /left:|box-shadow|border-radius/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /@media \(max-width:\s*760px\)/);
});

test('Evan entry preserves the regular session and adds a Mullins-branded meeting scheduler', () => {
  const route = read('app/agents/[slug]/page.tsx');
  const landing = read('components/evan/EvanLandingPage.tsx');
  const component = read('components/evan/EvanMeetingScheduler.tsx');
  const css = read('components/evan/EvanMeetingScheduler.module.css');
  assert.match(route, /agent\.slug === ['"]evan['"][\s\S]*rawMeetingProvider[\s\S]*<EvanMeetingScheduler/);
  assert.match(route, /if \(meetingProvider\) return <EvanMeetingScheduler initialProvider=\{meetingProvider\}/);
  assert.match(route, /return <EvanLandingPage agent=\{agent\} \/>/);
  assert.match(landing, /href=['"]\/agents\/evan\?meeting=google['"]/);
  assert.match(landing, /Invite Evan to a meeting/);
  assert.match(component, /Evan Mullins Moving\.png/);
  assert.match(component, /Evan Mullins Moving logo\.png/);
  assert.match(component, /data-evan-surface=['"]meeting-concierge['"]/);
  const required = [
    'scheduler', 'backLink', 'topline', 'headingRow', 'eyebrow', 'title', 'steps',
    'formStack', 'providerGrid', 'timingGrid', 'fieldGrid', 'joinNowNote', 'roleGrid',
    'optional', 'note', 'reviewCard', 'purposeReview', 'verifiedCard', 'verifyPanel',
    'sectionTitle', 'sectionCopy', 'fieldGridTwo', 'memoryChoice', 'verifyButton',
    'spinner', 'consentCopy', 'error', 'actions', 'secondaryButton', 'primaryButton',
    'platformMark', 'googleMark', 'zoomMark', 'teamsMark', 'confirmIcon', 'intro',
    'liveStatus', 'confirmFacts', 'durationGrid', 'dangerButton', 'dangerPanel', 'restoredNote',
  ];
  for (const className of required) assert.match(css, new RegExp(`\\.${className}(?:\\s|,|\\{|:)`), `missing .${className}`);
  assert.match(css, /--purple:\s*#5720bd/);
  assert.match(css, /--gold:\s*#f5b93f/);
  assert.match(css, /@media \(max-width:\s*760px\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test('installation guide exists and defines the next-agent isolation checklist', () => {
  const path = 'docs/meeting-concierge/v1/INSTALLATION.md';
  assert.ok(existsSync(resolve(root, path)));
  const guide = read(path);
  assert.match(guide, /Never import another agent's route, cookie, browser identity/);
  assert.match(guide, /Never hardcode a persona UUID/);
  assert.match(guide, /opaque HMAC ticket/);
  assert.match(guide, /meeting-scoped persona snapshot/i);
  assert.match(guide, /organizer removal/i);
  assert.match(guide, /does not bind a native Google Meet, Zoom, or Teams session into the website session spine/);
  assert.match(guide, /Do not promise a transcript, recap email, returning memory, Hermes review/);
});
