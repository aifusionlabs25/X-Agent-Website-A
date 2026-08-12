import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    AMY_CONVERSATION_END_MARKER,
    AMY_CONVERSATION_START_MARKER,
    installAmyConversationBlock,
} from '../scripts/anam/amy-conversation-prompt.mjs';

const prompt = await readFile(
    new URL('../config/anam/amy-conversation-naturalness-upgrade.md', import.meta.url),
    'utf8',
);
const workbenchPrompt = await readFile(
    new URL('../config/anam/amy-workbench-prompt-upgrade.md', import.meta.url),
    'utf8',
);
const publicSectorPrompt = await readFile(
    new URL('../config/anam/amy-public-sector-upgrade.md', import.meta.url),
    'utf8',
);
const reliabilityPrompt = await readFile(
    new URL('../config/anam/amy-cara4-reliability-upgrade.md', import.meta.url),
    'utf8',
);
const clientTools = JSON.parse(await readFile(
    new URL('../config/anam/amy-workbench-client-tools.json', import.meta.url),
    'utf8',
));
const visualBriefTool = clientTools.find((tool) => tool.name === 'show_visual_brief');
const baseBehavior = await readFile(
    new URL('../config/anam/amy-cara4-behavior-upgrade.md', import.meta.url),
    'utf8',
);
const updater = await readFile(
    new URL('../scripts/anam/update-amy-conversation.mjs', import.meta.url),
    'utf8',
);
const workbenchUpdater = await readFile(
    new URL('../scripts/anam/update-amy-workbench.mjs', import.meta.url),
    'utf8',
);
const readiness = await readFile(
    new URL('../lib/anam/persona-readiness.ts', import.meta.url),
    'utf8',
);
const websocketSmoke = await readFile(
    new URL('../scripts/anam/smoke-amy-websocket.mjs', import.meta.url),
    'utf8',
);

test('Amy uses human conversational rhythm without exposing qualification mechanics', () => {
    assert.match(prompt, /connect, listen, acknowledge/i);
    assert.match(prompt, /small useful observation/i);
    assert.match(prompt, /Answer a direct question meaningfully.*before asking/i);
    assert.match(prompt, /Do not end every response with a question/i);
    assert.match(prompt, /end two consecutive substantive responses with questions/i);
    assert.match(prompt, /situational rapport/i);
    assert.match(prompt, /Never say that a certain number of facts is required/i);
    assert.doesNotMatch(baseBehavior, /at least three confirmed facts/i);
});

test('Amy recognizes executive altitude and preserves her SDR mental model', () => {
    assert.match(prompt, /CIO, CTO, COO, CEO, CFO, VP, SVP/i);
    assert.match(prompt, /Start one altitude higher/i);
    assert.match(prompt, /AI-powered Inside Sales Development Representative/i);
    assert.match(prompt, /don't replace an architect or account executive/i);
    assert.match(prompt, /don't start from zero/i);
    assert.match(prompt, /First establish the outcome/i);
    assert.match(prompt, /Then learn the relevant context/i);
    assert.match(prompt, /Then clarify the constraint/i);
});

test('Amy enforces an SDR depth ceiling even when a visitor requests technical detail', () => {
    assert.match(prompt, /request for detail does not expand Amy's authority/i);
    assert.match(prompt, /architect, data engineer, analyst, clinician, security, privacy, or compliance specialist/i);
    assert.match(prompt, /Never infer causation, internal workflow stages, system fields or events, data availability, export capability/s);
    assert.match(prompt, /one high-level hypothesis.*label it unconfirmed/is);
    assert.match(prompt, /Each spoken turn does one useful job/i);
    assert.match(prompt, /request for detail never permits a long spoken list, numbered plan, chart menu/i);
    assert.match(prompt, /roughly fifteen seconds/i);
});

test('Amy treats healthcare operations and EHR data as specialist-governed discovery', () => {
    assert.match(prompt, /patient intake, clinical workflow, EHR or EMR/i);
    assert.match(prompt, /patient-level health information or PHI/i);
    assert.match(prompt, /authorized aggregated, de-identified, or synthetic operational data/i);
    assert.match(prompt, /Never assume an EHR records particular events or timestamps, permits export, exposes a usable schema/i);
    assert.match(prompt, /Do not prescribe an EHR extraction, query, data model, dashboard, statistical method, or chart design/i);
    assert.match(prompt, /healthcare and data specialist confirms what operational data is available/i);
    assert.match(prompt, /must not present an unverified root cause, metric, workflow stage, or chart as established/i);
});

test('Amy never exposes provider-thinking or internal-status failures', () => {
    assert.match(prompt, /Never say "I'm having trouble thinking right now," "I can't think,"/i);
    assert.match(prompt, /If evidence is missing, name the exact missing fact/i);
    assert.match(prompt, /clarify briefly or use skip_turn/i);
});

test('Amy keeps claim, handoff, and artifact guardrails intact', () => {
    assert.match(prompt, /Do not repeat "specialist" as a reflex/i);
    assert.match(prompt, /handoff is earned/i);
    assert.match(prompt, /call the matching tool instead of merely describing/i);
    assert.match(prompt, /working view based on the conversation/i);
    assert.match(prompt, /Never invent or imply confirmed products.*certifications.*contract eligibility/s);
    assert.match(prompt, /Keep technology fit, compliance, procurement, contract vehicles, funding.*distinct/s);
    assert.match(prompt, /approved attached knowledge source/i);
});

test('Amy fact-finds contract context without inventing jurisdiction or confirming a vehicle', () => {
    assert.match(publicSectorPrompt, /only after the visitor explicitly identifies Arizona or names SVAR/i);
    assert.match(publicSectorPrompt, /Never volunteer Arizona SVAR from browser location, IP-derived location, timezone, locale, area code, prior-session geography/i);
    assert.match(publicSectorPrompt, /general mention of procurement.*does not authorize Amy to name a vehicle/is);
    assert.match(publicSectorPrompt, /purchasing organization type, state or jurisdiction, actual purchasing entity, confirmed or possible funding source/is);
    assert.match(publicSectorPrompt, /Which state or jurisdiction will make the purchase\?/i);
    assert.match(publicSectorPrompt, /Bad: "Do you have an Arizona SVAR or GSA schedule\?"/i);
    assert.match(publicSectorPrompt, /does not confirm that a contract applies, covers a category, avoids competitive bidding, permits a funding source, establishes eligibility/i);
    assert.match(publicSectorPrompt, /move gracefully to the next business decision or specialist-validation step/i);
    assert.match(publicSectorPrompt, /Do not seek a redundant confirmation/i);
});

test('Amy truthfully rebuilds visual updates and confirms only the committed delta', () => {
    assert.ok(visualBriefTool, 'show_visual_brief tool must exist');

    for (const source of [prompt, workbenchPrompt, visualBriefTool.description]) {
        assert.match(source, /update, refresh, rebuild, or regenerate/i);
        assert.match(source, /call (?:the matching visual tool|show_visual_brief|this tool) again/i);
        assert.match(source, /contentChanged, appliedChanges, and visibleFacts/i);
        assert.match(source, /only source of truth/i);
        assert.match(source, /requested delta is absent from both appliedChanges and visibleFacts/i);
        assert.match(source, /requested change did not land/i);
        assert.match(source, /one precise clarification/i);
        assert.match(source, /one short sentence/i);
        assert.match(source, /planning assumptions? explicitly/i);
        assert.match(source, /concurrent timelines separate and named/i);
        assert.match(source, /scope expansion|scope-expansion/i);
        assert.match(source, /generic guardrail/i);
    }

    assert.match(workbenchPrompt, /budget review next quarter.*preferred deferral until next year/i);
    assert.match(workbenchPrompt, /never infer an applied change.*revision number increased/i);
    assert.match(prompt, /Never claim the view was updated, refreshed, expanded, or now includes the detail/i);
});

test('Amy treats student-risk AI and compressed board timelines as high-impact discovery', () => {
    assert.match(prompt, /student-retention or at-risk-student scenarios/i);
    assert.match(prompt, /privacy and institutional policy/i);
    assert.match(prompt, /fairness and explainability expectations/i);
    assert.match(prompt, /required human review/i);
    assert.match(prompt, /counseling, financial-aid, disability, health/i);
    assert.match(prompt, /de-identified or synthetic data/i);
    assert.match(prompt, /three-day deadline may support a board-ready concept, mockup, or tightly bounded feasibility demonstration/i);
    assert.match(prompt, /never call a student-risk model validated, production-ready, or feasible/i);
    assert.match(prompt, /Do not name products, prescribe data pipelines, or promise a pilot timeline/i);
});

test('Amy separates active incidents from compressed executive AI deliverables', () => {
    assert.match(prompt, /outage, security incident, or material service disruption/i);
    assert.match(prompt, /separate operational stabilization from the requested strategy/i);
    assert.match(prompt, /bounded offline concept, approved historical-data analysis, or synthetic demonstration/i);
    assert.match(prompt, /contact-center recordings, transcripts, or ticket logs/i);
    assert.match(prompt, /PII or payment-data exposure/i);
    assert.match(prompt, /stabilize the incident, rebaseline delayed work/i);
    assert.match(prompt, /Do not let the deadline convert a presentation request into an implementation promise/i);
});

test('Amy live updater is dry-run first, identity-pinned, backed up, and drift-checked', () => {
    assert.match(updater, /mode: 'dry-run'/);
    assert.match(updater, /CONFIRM_AMY_CONVERSATION_SYNC/);
    assert.match(updater, /expected-current-sha256/);
    assert.match(updater, /backup-dir/);
    assert.match(updater, /flag: 'wx'/);
    assert.match(updater, /protected provider configuration changed/i);
    assert.match(updater, /0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08/);
    assert.match(readiness, /AMY_CONVERSATION_NATURALNESS_START/);
    assert.match(readiness, /AMY_CONVERSATION_NATURALNESS_END/);
});

test('Amy Workbench updater is dry-run first, identity-pinned, backed up, and fully verified', () => {
    assert.match(workbenchUpdater, /mode: 'dry-run'/);
    assert.match(workbenchUpdater, /if \(!applying\)/);
    assert.match(workbenchUpdater, /CONFIRM_AMY_WORKBENCH_SYNC/);
    assert.match(workbenchUpdater, /expected-current-sha256/);
    assert.match(workbenchUpdater, /freshly fetched Amy prompt/i);
    assert.match(workbenchUpdater, /path\.isAbsolute\(rawBackupDir\)/);
    assert.match(workbenchUpdater, /backup-dir must be outside the repository/i);
    assert.match(workbenchUpdater, /description must contain 1 to 1024 characters/i);
    assert.match(workbenchUpdater, /const promptUpgrade = normalize\(await fs\.readFile/);
    assert.match(workbenchUpdater, /persona: before/);
    assert.match(workbenchUpdater, /matchingWorkbenchTools/);
    assert.match(workbenchUpdater, /flag: 'wx'/);

    assert.match(workbenchUpdater, /0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08/);
    assert.match(workbenchUpdater, /Amy Insight SDR - Cara 4 Canary/);
    assert.match(workbenchUpdater, /36e17abf-ef6c-4bef-99bd-3f925da155eb/);
    assert.match(workbenchUpdater, /avatarModel: 'cara-4'/);
    assert.match(workbenchUpdater, /b138c2a2-ba66-4887-95d5-1a57093fc92d/);
    assert.match(workbenchUpdater, /a7cf662c-2ace-4de1-a21e-ef0fbf144bb7/);
    assert.match(workbenchUpdater, /AMY_CONVERSATION_NATURALNESS_START/);
    assert.match(workbenchUpdater, /AMY_CARA4_RELIABILITY_START/);
    assert.match(workbenchUpdater, /AMY_PUBLIC_SECTOR_START/);
    assert.match(workbenchUpdater, /AMY_WORKBENCH_START/);
    assert.match(workbenchUpdater, /AMY_AGENTMAIL_START/);
    assert.match(workbenchUpdater, /required managed prompt markers are malformed or missing/i);

    assert.match(workbenchUpdater, /function normalizedToolDefinition[\s\S]*description:[\s\S]*type:[\s\S]*config:/);
    assert.match(workbenchUpdater, /JSON\.stringify\(verifiedToolIds\) !== JSON\.stringify\(nextToolIds\)/);
    assert.match(workbenchUpdater, /FORBIDDEN_TOOL_NAMES = new Set\(\['capture_sales_handoff', 'end_call'\]\)/);
    assert.match(workbenchUpdater, /legacyEndCallAttached: false/);
    assert.match(workbenchUpdater, /reliabilityUpgrade/);
    assert.match(workbenchUpdater, /publicSectorUpgrade/);
    assert.match(workbenchUpdater, /descriptionTypeConfig/);
    assert.match(workbenchUpdater, /protectedPersonaProviderStateUnchanged: true/);
    assert.match(workbenchUpdater, /workbenchToolDefinitionsVerified: true/);

    const backupIndex = workbenchUpdater.indexOf('await fs.writeFile(backupPath');
    const firstPutIndex = workbenchUpdater.indexOf("method: 'PUT'", backupIndex);
    const firstPostIndex = workbenchUpdater.indexOf("method: 'POST'", backupIndex);
    assert.ok(backupIndex >= 0, 'Workbench backup must be written');
    assert.ok(firstPutIndex > backupIndex, 'Workbench backup must precede the first PUT');
    assert.ok(firstPostIndex > backupIndex, 'Workbench backup must precede the first POST');
    assert.doesNotMatch(workbenchUpdater, /console\.log\([^)]*(apiKey|ANAM_API_KEY|Authorization)/s);
});

test('Amy conversation block installation is front-loaded, replaceable, and idempotent', () => {
    const first = installAmyConversationBlock('BASE\r\nPROMPT', prompt);
    assert.ok(first.startsWith(AMY_CONVERSATION_START_MARKER));
    assert.match(first, /AMY_CONVERSATION_NATURALNESS_END -->\n\nBASE\nPROMPT\n$/);
    assert.equal(installAmyConversationBlock(first, prompt), first);

    const revised = prompt.replace('brief synthesis beats a full recap.', 'synthesize before continuing.');
    const replaced = installAmyConversationBlock(first, revised);
    assert.match(replaced, /synthesize before continuing/);
    assert.doesNotMatch(replaced, /brief synthesis beats a full recap/);
    assert.equal(replaced.split(AMY_CONVERSATION_START_MARKER).length - 1, 1);
    assert.equal(replaced.split(AMY_CONVERSATION_END_MARKER).length - 1, 1);
    assert.match(replaced, /BASE\nPROMPT\n$/);
});

test('Amy conversation block installer refuses malformed managed markers', () => {
    assert.throws(
        () => installAmyConversationBlock(`${AMY_CONVERSATION_START_MARKER}\nbroken`, prompt),
        /markers are malformed/i,
    );
});

test('Amy has one canonical Insight greeting and a hard spoken ceiling', () => {
    assert.match(prompt, /Hi, I'm Amy with Insight Enterprises\. Who am I speaking with today\?/);
    assert.match(prompt, /After the visitor gives a name.*What would be most useful to work through today/s);
    assert.match(prompt, /Never stack the name question and the discovery question/i);
    assert.match(prompt, /never speak a numbered plan or more than forty words/i);
    assert.match(reliabilityPrompt, /configured greeting is exact and complete/i);
    assert.match(workbenchUpdater, /AMY_INITIAL_MESSAGE/);
    assert.match(workbenchUpdater, /initialMessage: AMY_INITIAL_MESSAGE/);
    assert.match(reliabilityPrompt, /After a meaningful Workbench brief exists.*offer the follow-up email once/s);
    assert.match(reliabilityPrompt, /closing intent wins.*do not delay the close/s);
});

test('Amy separates AI interest from a pilot and preserves the CJIS boundary', () => {
    assert.match(prompt, /Interest in AI is not a pilot/i);
    assert.match(prompt, /What would you do if you were me.*does not expand Amy's authority/s);
    assert.match(prompt, /non-sensitive.*do not prove.*outside the CJIS boundary/s);
    assert.match(publicSectorPrompt, /administrative.*non-sensitive.*not case files.*does not establish.*outside the CJIS boundary/s);
    assert.match(reliabilityPrompt, /That's what I needed.*not explicit closing intent/s);
});

test('Amy closes with an outcome motion, private check-in email offer, and optional confirmed callback', async () => {
    const emailPrompt = await readFile(new URL('../config/anam/amy-agentmail-prompt-upgrade.md', import.meta.url), 'utf8');
    const emailTool = JSON.parse(await readFile(new URL('../config/anam/amy-agentmail-client-tool.json', import.meta.url), 'utf8'));
    assert.match(reliabilityPrompt, /soft close.*wrap it here.*closing motion/is);
    assert.match(reliabilityPrompt, /soft close.*Call `end_amy_session` silently.*closing_motion_required/is);
    assert.match(reliabilityPrompt, /priority, the confirmed guardrail, and the useful next decision/i);
    assert.match(reliabilityPrompt, /final recap and Visual Brief emailed to the private check-in address/i);
    assert.match(reliabilityPrompt, /phone follow-up would be useful/i);
    assert.match(reliabilityPrompt, /hard close.*goodbye.*skips the closing motion/is);
    assert.match(emailPrompt, /Never ask for it, spell it, repeat it.*email address/is);
    assert.match(emailPrompt, /speaks or spells an email address.*do not parse it, reconstruct it, repeat it, correct it, or store it/is);
    assert.match(emailPrompt, /Spoken words such as "at," "at symbol," or "dot".*never update/is);
    assert.match(emailPrompt, /callback number.*explicit yes/is);
    assert.match(emailPrompt, /second tool call is allowed only to append a callback number/i);
    assert.match(workbenchUpdater, /amy-agentmail-client-tool\.json/);
    assert.match(workbenchUpdater, /amy-agentmail-prompt-upgrade\.md/);
    assert.match(workbenchUpdater, /AMY_AGENTMAIL_START/);
    assert.ok(emailTool.config.parameters.properties.callbackPhone);
    assert.ok(emailTool.config.parameters.properties.callbackPhoneConfirmed);
});

test('Amy WebSocket smoke test is identity-pinned and exposes no credentials', () => {
    assert.match(websocketSmoke, /0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08/);
    assert.match(websocketSmoke, /\/auth\/session-token/);
    assert.match(websocketSmoke, /\/engine\/session/);
    assert.match(websocketSmoke, /new WebSocket\(socketUrl\)/);
    assert.match(websocketSmoke, /socket\.close\(1000, 'smoke-test-complete'\)/);
    assert.match(websocketSmoke, /websocketCloseRequested: true/);
    assert.doesNotMatch(websocketSmoke, /console\.log\([^)]*(apiKey|sessionToken|engine\.sessionId)/s);
});
