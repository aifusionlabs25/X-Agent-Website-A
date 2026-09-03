import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    AMY_CONVERSATION_END_MARKER,
    AMY_CONVERSATION_START_MARKER,
    installAmyConversationBlock,
    removeDeprecatedAmyBehaviorBlock,
} from '../scripts/anam/amy-conversation-prompt.mjs';
import {
    buildExpectedAmyPrompt,
    installAmyCoreBlock,
} from '../scripts/anam/update-amy-workbench.mjs';

const prompt = await readFile(
    new URL('../config/anam/amy-conversation-naturalness-upgrade.md', import.meta.url),
    'utf8',
);
const corePrompt = await readFile(
    new URL('../config/anam/amy-core-system-prompt.md', import.meta.url),
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
const agentMailPrompt = await readFile(
    new URL('../config/anam/amy-agentmail-prompt-upgrade.md', import.meta.url),
    'utf8',
);
const clientTools = JSON.parse(await readFile(
    new URL('../config/anam/amy-workbench-client-tools.json', import.meta.url),
    'utf8',
));
const visualBriefTool = clientTools.find((tool) => tool.name === 'show_visual_brief');
const amyIntelligenceTool = clientTools.find((tool) => tool.name === 'show_amy_intelligence');
const baseBehavior = await readFile(
    new URL('../config/anam/amy-cara4-behavior-upgrade.md', import.meta.url),
    'utf8',
);
const updater = await readFile(
    new URL('../scripts/anam/update-amy-conversation.mjs', import.meta.url),
    'utf8',
);
const agentMailUpdater = await readFile(
    new URL('../scripts/anam/update-amy-agentmail.mjs', import.meta.url),
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
const packageManifest = JSON.parse(await readFile(
    new URL('../package.json', import.meta.url),
    'utf8',
));

test('Amy uses human conversational rhythm without exposing qualification mechanics', () => {
    assert.match(prompt, /connect, listen, acknowledge/i);
    assert.match(prompt, /small useful observation/i);
    assert.match(prompt, /Answer the actual decision question; never ask the visitor to repeat it/i);
    assert.match(prompt, /integrated-versus-phased or bundled-versus-separate questions, offer conditional business trade-offs—not architecture, assumed entitlements, a selected path, or schedule validation/i);
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
    assert.match(prompt, /does not replace an architect or account executive/i);
    assert.match(prompt, /First establish the outcome/i);
    assert.match(prompt, /then learn relevant context and the constraint that changes the path/i);
});

test('session 3d852e0a regression: Amy stays in a bounded executive capability interview', () => {
    const compilerIndex = prompt.indexOf('Front-loaded mode and response compiler');
    const deliveryIndex = prompt.indexOf('Conversation delivery');
    assert.ok(compilerIndex >= 0 && compilerIndex < deliveryIndex, 'mode routing must precede delivery rules');
    assert.ok(prompt.trim().split(/\s+/).length <= 2700, 'managed delivery layer must stay compact');

    assert.match(prompt, /evaluating, interviewing, reviewing, or testing Amy or an X Agent/i);
    assert.match(prompt, /claimed Insight role or executive title.*context only.*not authentication, permission, or access/is);
    assert.match(prompt, /Keep capability interview mode active until.*real customer opportunity.*role-play/is);
    assert.match(prompt, /supplies a name and an interview or capability question in the same turn.*answer the question in that same response/is);
    assert.match(prompt, /never give a name-only acknowledgment or make them repeat it/i);
    assert.match(prompt, /doubtful name.*such as “still”.*do not repeat it as their name/is);
    assert.match(prompt, /fictional-scenario sandbox.*Never turn role-play into customer facts or sales intake/is);
    assert.match(prompt, /Never redirect.*tell me what you do.*show me.*generic discovery.*without a real opportunity/is);

    assert.match(prompt, /explicitly hypothetical three-beat walkthrough.*customer signal.*working view.*Insight validation/is);
    assert.match(prompt, /Insight Intelligence.*features, capabilities.*show_amy_intelligence.*once if attached/is);
    assert.match(prompt, /non-customer overview/i);
    assert.match(prompt, /unless the browser already opened it.*Acknowledge the non-customer overview briefly/is);
    assert.match(prompt, /Sample-brief requests use the sample instead/i);
    assert.match(workbenchPrompt, /fictional example without customer discovery.*Never invent sample facts/is);
    assert.match(workbenchPrompt, /set the deadline to February 2, 2027.*Never announce.*before completion/is);
    assert.ok(amyIntelligenceTool, 'show_amy_intelligence tool must exist');
    assert.match(amyIntelligenceTool.description, /Insight Intelligence Layer/i);
    assert.match(amyIntelligenceTool.description, /not a customer Visual Brief/i);
    assert.match(prompt, /Use at most one tool call per visitor turn/i);
    assert.match(prompt, /Never retry a failed tool automatically/i);

    assert.match(prompt, /post-session bundle.*visitor delivery.*configured demo admin and intake copies/is);
    assert.match(prompt, /not an Insight CRM record or proof of human action/i);
    assert.match(prompt, /Never promise review, contact, handoff, or next steps without an exact action receipt/i);
    assert.match(prompt, /fifteen to thirty words.*hard ceiling of forty-five spoken words.*explicit request for detail may approach sixty/is);
    assert.match(prompt, /Finish the sentence and thought/i);
});

test('Amy handles the exact final CEO-demo conversation failures directly', () => {
    assert.match(prompt, /asks whether Amy has questions for them.*ask one strategic evaluation question/is);
    assert.match(prompt, /Do not refuse, recite demo disclaimers, or say Amy cannot ask/i);
    assert.match(prompt, /Give me the executive version.*no more than twenty-five words/is);
    assert.match(prompt, /Open a visual only when the visitor explicitly asks to see, open, display, or build one/i);
    assert.match(prompt, /hypothetical future integration.*approved backend integration could make the capability possible/is);
    assert.match(prompt, /Do not repeatedly deny the current connection, design the architecture, or turn the answer into a technical plan/i);
    assert.match(prompt, /AI Fusion Labs.*independent team behind this demo.*designs and prototypes practical AI experiences/is);
    assert.match(prompt, /Never claim Insight approved Amy, her knowledge, or AI Fusion Labs/i);
    assert.match(prompt, /person who shared the demo or an AI Fusion Labs contact.*not.*Insight's channels/is);
    assert.match(prompt, /Never volunteer an internal business unit, named contract vehicle, jurisdiction, architecture, policy, data requirement, or deployment pattern/i);
    assert.match(prompt, /curated, public-safe knowledge base prepared for this independent demo/i);
    assert.match(prompt, /It has been nice speaking with you.*alone is not a close request/is);
    assert.match(prompt, /Never use spoken markdown, numbered lists, or bold markers/i);
});

test('Amy politely refuses live product-data lookup in the current demo', () => {
    assert.match(prompt, /SKU, part number, live inventory, price, availability, lead-time, or contract-eligibility lookup.*call no tool/is);
    assert.match(prompt, /even if asked to open, show, or search the catalog/is);
    assert.match(prompt, /demo lacks a live catalog connection/i);
    assert.match(prompt, /requires an approved Insight integration/i);
    assert.match(prompt, /Offer verbal directional categories or capture needs/i);
    assert.match(prompt, /Never imply live product data is available/i);
    assert.match(prompt, /Except for the live product-data boundary above.*directional catalog/is);
    assert.match(clientTools.find((tool) => tool.name === 'show_solution_catalog')?.description ?? '', /Never call this tool if the same request asks for a live SKU, part number, inventory, price, availability, lead time, contract eligibility, or product-data search/i);
    assert.match(workbenchPrompt, /If the request also asks for a live SKU, part number, inventory, price, availability, lead time, contract eligibility, or product-data search, call no display tool/is);
});

test('Amy enforces an SDR depth ceiling even when a visitor requests technical detail', () => {
    assert.match(prompt, /request for detail does not expand Amy's authority/i);
    assert.match(prompt, /architect, data engineer, analyst, clinician, security, privacy, or compliance specialist/i);
    assert.match(prompt, /Technical credibility means translating a technical signal into the business decision.*never means solving/is);
    assert.match(prompt, /authority ladder.*confirmed business meaning.*fact that remains unvalidated.*appropriate Insight specialist/is);
    assert.match(prompt, /stop before assessment, diagnosis, product selection, solution design, configuration, implementation/is);
    assert.match(prompt, /Never infer causation, internal workflow stages, system fields or events, data availability, export capability/s);
    assert.match(prompt, /one high-level hypothesis.*label it unconfirmed/is);
    assert.match(prompt, /Each spoken turn does one useful job/i);
    assert.match(prompt, /request for detail never permits a long spoken list, numbered plan, chart menu/i);
    assert.match(prompt, /roughly fifteen seconds/i);
});

test('session f00c3743: Amy keeps technical fluency without prescribing security remediation', () => {
    assert.match(prompt, /Explain technical terms when asked.*approved knowledge.*without environment-specific prescriptions/i);
    assert.match(prompt, /Visitor-reported control mappings and technical minimums are not Amy-validated/i);
    assert.match(prompt, /Scope and criticality do not establish effort, parallel execution, or feasibility/i);
    assert.match(prompt, /Identify one business-level validation decision and stop/i);
    assert.doesNotMatch(prompt, /Give one business-level sequencing recommendation/i);

    assert.match(reliabilityPrompt, /Explain general technical meaning when asked.*does not authorize a recommendation/is);
    assert.match(reliabilityPrompt, /What requirement did your review document\?/i);
    assert.match(reliabilityPrompt, /Never introduce a TLS version or other minimum for the visitor to confirm/i);
    assert.match(reliabilityPrompt, /Attribute reported standards and control mappings to their review/i);
    assert.match(reliabilityPrompt, /do not endorse them as "the right families" or independently sufficient/i);
    assert.match(reliabilityPrompt, /smaller scope does not mean a faster fix/i);
    assert.match(reliabilityPrompt, /reported encryption minimum does not establish rollout readiness or parallel execution/i);
    assert.match(reliabilityPrompt, /leave feasibility, dependencies, sequencing, and effort to the security owner and Insight specialists/i);
    assert.match(reliabilityPrompt, /What modernization work is already planned, and where might it overlap with those findings\?/i);
});

test('session f00c3743: display narration is a single application-grounded receipt sentence', () => {
    for (const source of [prompt, reliabilityPrompt, workbenchPrompt]) {
        assert.match(source, /speak (?:the receipt's )?spokenConfirmation verbatim once/i);
    }
    assert.match(prompt, /one short sentence, then stop/i);
    assert.match(prompt, /Tool arguments are not evidence/i);
    assert.match(workbenchPrompt, /never repeat it or append an explanation or question/i);
    assert.match(workbenchPrompt, /Without spokenConfirmation, confirm only the view is open/i);
    assert.match(workbenchPrompt, /Tool arguments and earlier dialogue are not proof of the rendered content/i);
    assert.match(workbenchPrompt, /later asks what the roadmap shows, use only the returned visibleRoadmap fields/i);
    assert.match(workbenchPrompt, /Do not narrate a requested two-track plan over a generic roadmap/i);
    assert.match(workbenchPrompt, /not.*infer parallel execution, effort, owners, or marked assumptions not present in that receipt/i);
    assert.match(workbenchPrompt, /addition or replacement only when its exact detail appears in both appliedChanges and visibleFacts/i);
    assert.match(workbenchPrompt, /removal only when appliedChanges marks it removed and visibleFacts omits it/i);
    assert.doesNotMatch(workbenchPrompt, /fact was actually stated in the current conversation/i);
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
    assert.match(prompt, /Never use `skip_turn` on a completed direct question or request/i);
    assert.match(reliabilityPrompt, /never overrides a clear direct question or actionable request/i);
});

test('Amy describes Meeting Concierge and demo follow-up truthfully', () => {
    assert.match(prompt, /independent AI Fusion Labs demonstration.*not an official Insight deployment/is);
    assert.match(prompt, /confirm an organizer can invite Amy to Google Meet, Zoom, or Microsoft Teams after private check-in/is);
    assert.match(prompt, /Never say "X Agents Meeting Concierge" or another internal implementation name/i);
    assert.doesNotMatch(prompt, /Through X Agents Meeting Concierge/i);
    assert.match(prompt, /keeps her SDR boundaries and leaves when asked/i);
    assert.match(prompt, /Never imply uninvited access.*secret monitoring.*recording/is);
    assert.match(agentMailPrompt, /configured admin and intake copies/i);
    assert.match(agentMailPrompt, /Never call them an official Insight record, CRM entry, accepted lead/i);
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
        assert.match(source, /update, refresh, rebuild, or regenerate|displayed-visual update/i);
        assert.match(source, /call (?:the matching visual tool|show_visual_brief|this tool) again|use the matching tool unless the browser already committed this request/i);
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
    assert.match(workbenchPrompt, /browser display receipt is authoritative.*do not call the display tool again/i);
    assert.match(workbenchPrompt, /actual update is still pending.*once, then remain silent until its receipt/i);
    assert.match(workbenchPrompt, /A failure is not a pending update/i);
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

test('legacy Amy conversation and AgentMail live writers fail closed before environment or network access', () => {
    for (const legacyUpdater of [updater, agentMailUpdater]) {
        assert.match(legacyUpdater.trim(), /^throw new Error\(/);
        assert.match(legacyUpdater, /Deprecated Amy live writer/i);
        assert.match(legacyUpdater, /anam:update-amy-workbench/);
        assert.doesNotMatch(legacyUpdater, /process\.env|fetch\s*\(|ANAM_API_KEY|node:fs/);
    }
    assert.equal(packageManifest.scripts['anam:update:amy-conversation'], undefined);
    assert.equal(packageManifest.scripts['anam:update-amy-agentmail'], undefined);
    assert.match(readiness, /AMY_RUNTIME_MANAGED_PROMPT_MARKER_PAIRS/);
    assert.match(readiness, /inspectAmyRuntimeRelease/);
});

test('Amy Workbench updater is dry-run first, identity-pinned, backed up, and fully verified', () => {
    assert.match(workbenchUpdater, /mode: 'dry-run'/);
    assert.match(workbenchUpdater, /if \(!applying\)/);
    assert.match(workbenchUpdater, /CONFIRM_AMY_WORKBENCH_SYNC/);
    assert.match(workbenchUpdater, /expected-current-sha256/);
    assert.match(workbenchUpdater, /expected-persona-inventory-sha256/);
    assert.match(workbenchUpdater, /expected-tool-inventory-sha256/);
    assert.match(workbenchUpdater, /freshly fetched dry-run hash/i);
    assert.match(workbenchUpdater, /path\.isAbsolute\(rawBackupDir\)/);
    assert.match(workbenchUpdater, /backup-dir must be outside the repository/i);
    assert.match(workbenchUpdater, /description must contain 1 to 1024 characters/i);
    assert.match(workbenchUpdater, /amy-live-identity-client-tool\.json/);
    assert.match(workbenchUpdater, /completePersonaInventory/);
    assert.match(workbenchUpdater, /completeToolInventory/);
    assert.match(workbenchUpdater, /flag: 'wx'/);

    assert.match(workbenchUpdater, /0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08/);
    assert.match(workbenchUpdater, /Amy Insight SDR - Cara 4 Canary/);
    assert.match(workbenchUpdater, /36e17abf-ef6c-4bef-99bd-3f925da155eb/);
    assert.match(workbenchUpdater, /avatarModel: 'cara-4'/);
    assert.match(workbenchUpdater, /b138c2a2-ba66-4887-95d5-1a57093fc92d/);
    assert.match(workbenchUpdater, /65421f1c-c7de-4bc4-ac27-d171c16ef41f/);
    assert.match(workbenchUpdater, /AMY_CONVERSATION_NATURALNESS_START/);
    assert.match(workbenchUpdater, /AMY_CARA4_RELIABILITY_START/);
    assert.match(workbenchUpdater, /AMY_PUBLIC_SECTOR_START/);
    assert.match(workbenchUpdater, /AMY_WORKBENCH_START/);
    assert.match(workbenchUpdater, /AMY_AGENTMAIL_START/);
    assert.match(workbenchUpdater, /required managed prompt markers are malformed or missing/i);
    assert.match(workbenchUpdater, /amy-conversation-naturalness-upgrade\.md/);
    assert.match(workbenchUpdater, /amy-core-system-prompt\.md/);
    assert.match(workbenchUpdater, /amy-cara4-behavior-upgrade\.md/);
    assert.match(workbenchUpdater, /removeDeprecatedAmyBehaviorBlock/);
    assert.match(workbenchUpdater, /installAmyConversationBlock/);
    assert.match(workbenchUpdater, /deprecatedLegacyBehaviorRemoved/);
    assert.match(workbenchUpdater, /legacyCoreReplaced/);
    assert.match(workbenchUpdater, /naturalness block is not front-loaded/i);
    assert.match(workbenchUpdater, /assertNoDeprecatedAmyPromptInstructions/);
    assert.match(workbenchUpdater, /deprecated Amy prompt instructions remain/i);

    assert.match(workbenchUpdater, /function toolDefinitionView[\s\S]*name:[\s\S]*description:[\s\S]*type:[\s\S]*disableInterruptions:[\s\S]*config:/);
    assert.match(workbenchUpdater, /clone-and-swap-production-only/);
    assert.match(workbenchUpdater, /reuse-shared-unchanged/);
    assert.match(workbenchUpdater, /detach-production-only/);
    assert.match(workbenchUpdater, /assertOtherPersonasUnchanged/);
    assert.match(workbenchUpdater, /FORBIDDEN_TOOL_NAMES = new Set\(\[[^\]]*'capture_sales_handoff'[^\]]*'end_call'[^\]]*'search_insight_catalog'[^\]]*\]\)/s);
    assert.match(workbenchUpdater, /reliabilityUpgrade/);
    assert.match(workbenchUpdater, /publicSectorUpgrade/);
    assert.match(workbenchUpdater, /protectedPersonaStateVerifiedUnchanged: true/);
    assert.match(workbenchUpdater, /unrelatedAndSharedToolsVerifiedUnchanged: true/);
    assert.match(workbenchUpdater, /knowledgeToolIdIsDynamicallyPreserved: true/);
    assert.doesNotMatch(workbenchUpdater, /method:\s*['"]DELETE['"]/);

    const backupIndex = workbenchUpdater.indexOf('await fs.writeFile(backupPath');
    const firstPutIndex = workbenchUpdater.indexOf("method: 'PUT'", backupIndex);
    const firstCreateIndex = workbenchUpdater.indexOf('await createToolWithInventoryRecovery(', backupIndex);
    assert.ok(backupIndex >= 0, 'Workbench backup must be written');
    assert.ok(firstPutIndex > backupIndex, 'Workbench backup must precede the first PUT');
    assert.ok(firstCreateIndex > backupIndex, 'Workbench backup must precede the first tool creation');
    assert.doesNotMatch(workbenchUpdater, /console\.log\([^)]*(apiKey|ANAM_API_KEY|Authorization)/s);
    const personaPayloads = [...workbenchUpdater.matchAll(/body:\s*JSON\.stringify\(\{([\s\S]*?)\}\)/g)]
        .map(match => match[1])
        .filter(body => /systemPrompt:\s*expectedPrompt/.test(body));
    assert.equal(personaPayloads.length, 1, 'Workbench must make one atomic managed persona payload');
    assert.match(personaPayloads[0], /initialMessage:\s*AMY_INITIAL_MESSAGE/);
    assert.match(personaPayloads[0], /toolIds:\s*nextToolIds/);

    const anamWiring = packageManifest.scripts['test:anam'];
    const daniWiring = packageManifest.scripts['test:anam:dani'];
    assert.match(anamWiring, /tests\/amy-workbench-sync-isolation\.test\.mjs/);
    for (const expected of [
        'tests/dani-anam-config.test.mjs',
        'tests/dani-live-qa.test.mjs',
        'tests/dani-session-close.test.mjs',
        'tests/dani-meeting-participation.test.mjs',
    ]) assert.match(anamWiring, new RegExp(expected.replaceAll('.', '\\.')));
    for (const expected of [
        'tests/dani-session.test.mjs',
        'tests/dani-editorial-ui.test.mjs',
        'tests/dani-user-memory.test.mjs',
        'tests/dani-memory-candidate.test.mjs',
        'tests/dani-memory-pipeline.test.mjs',
    ]) assert.match(daniWiring, new RegExp(expected.replaceAll('.', '\\.')));
});

test('Amy conversation block installation is front-loaded, replaceable, and idempotent', () => {
    const first = installAmyConversationBlock('BASE\r\nPROMPT', prompt);
    assert.ok(first.startsWith(AMY_CONVERSATION_START_MARKER));
    assert.match(first, /AMY_CONVERSATION_NATURALNESS_END -->\n\nBASE\nPROMPT\n$/);
    assert.equal(installAmyConversationBlock(first, prompt), first);

    const revised = prompt.replace('never ask the visitor to repeat it.', 'synthesize before continuing.');
    const replaced = installAmyConversationBlock(first, revised);
    assert.match(replaced, /synthesize before continuing/);
    assert.doesNotMatch(replaced, /never ask the visitor to repeat it/);
    assert.equal(replaced.split(AMY_CONVERSATION_START_MARKER).length - 1, 1);
    assert.equal(replaced.split(AMY_CONVERSATION_END_MARKER).length - 1, 1);
    assert.match(replaced, /BASE\nPROMPT\n$/);
});

test('Amy conversation sync removes the exact deprecated contact-solicitation layer only once', () => {
    const legacy = `${baseBehavior.trim()}\n`;
    const source = `Base prompt.\n\n${legacy}\n<!-- AMY_CARA4_RELIABILITY_START -->\nCurrent reliability\n<!-- AMY_CARA4_RELIABILITY_END -->\n`;
    const first = removeDeprecatedAmyBehaviorBlock(source, legacy);
    assert.equal(first.removed, true);
    assert.doesNotMatch(first.prompt, /Earn the right to ask for contact information/i);
    assert.match(first.prompt, /Current reliability/);
    const second = removeDeprecatedAmyBehaviorBlock(first.prompt, legacy);
    assert.equal(second.removed, false);
    assert.equal(second.prompt, first.prompt);
    assert.throws(
        () => removeDeprecatedAmyBehaviorBlock(`${source}\n${legacy}`, legacy),
        /malformed or differs from the reviewed source/i,
    );
});

test('the single Workbench prompt build front-loads naturalness and removes only the reviewed legacy layer', () => {
    const replacements = [
        ['reliability', reliabilityPrompt.trim(), '<!-- AMY_CARA4_RELIABILITY_START -->', '<!-- AMY_CARA4_RELIABILITY_END -->'],
        ['public-sector', publicSectorPrompt.trim(), '<!-- AMY_PUBLIC_SECTOR_START -->', '<!-- AMY_PUBLIC_SECTOR_END -->'],
        ['Workbench', workbenchPrompt.trim(), '<!-- AMY_WORKBENCH_START -->', '<!-- AMY_WORKBENCH_END -->'],
        ['AgentMail', agentMailPrompt.trim(), '<!-- AMY_AGENTMAIL_START -->', '<!-- AMY_AGENTMAIL_END -->'],
    ];
    const beforePrompt = [
        prompt.trim(),
        'AMY — INSIGHT ENTERPRISE SDR\nANAM SYSTEM PROMPT\nVERSION: AMY_ANAM_V2_2026_07_15\n\nLEGACY CORE CONTENT',
        workbenchPrompt.trim(),
        reliabilityPrompt.trim(),
        publicSectorPrompt.trim(),
        agentMailPrompt.trim(),
        baseBehavior.trim(),
    ].join('\n\n');
    const first = buildExpectedAmyPrompt({
        beforePrompt,
        naturalnessUpgrade: prompt,
        corePrompt,
        deprecatedBehavior: baseBehavior,
        replacements,
    });
    assert.equal(first.deprecatedLegacyBehaviorRemoved, true);
    assert.ok(first.expectedPrompt.startsWith(prompt.trim().replace(/\r\n?/g, '\n')));
    assert.doesNotMatch(first.expectedPrompt, /# Amy Cara 4 behavior upgrade/);
    assert.match(first.expectedPrompt, /CORE ROLE AND OPERATING MODEL/);
    assert.doesNotMatch(first.expectedPrompt, /AMY_ANAM_V2_2026_07_15|LEGACY CORE CONTENT/);
    assert.equal(first.legacyCoreReplaced, true);
    for (const marker of [
        AMY_CONVERSATION_START_MARKER,
        AMY_CONVERSATION_END_MARKER,
        '<!-- AMY_CORE_START -->',
        '<!-- AMY_CORE_END -->',
        '<!-- AMY_CARA4_RELIABILITY_START -->',
        '<!-- AMY_CARA4_RELIABILITY_END -->',
        '<!-- AMY_PUBLIC_SECTOR_START -->',
        '<!-- AMY_PUBLIC_SECTOR_END -->',
        '<!-- AMY_WORKBENCH_START -->',
        '<!-- AMY_WORKBENCH_END -->',
        '<!-- AMY_AGENTMAIL_START -->',
        '<!-- AMY_AGENTMAIL_END -->',
    ]) assert.equal(first.expectedPrompt.split(marker).length - 1, 1, `${marker} must occur once`);

    const second = buildExpectedAmyPrompt({
        beforePrompt: first.expectedPrompt,
        naturalnessUpgrade: prompt,
        corePrompt,
        deprecatedBehavior: baseBehavior,
        replacements,
    });
    assert.equal(second.deprecatedLegacyBehaviorRemoved, false);
    assert.equal(second.legacyCoreReplaced, false);
    assert.equal(second.expectedPrompt, first.expectedPrompt);

    const installedFromMissing = buildExpectedAmyPrompt({
        beforePrompt: beforePrompt.replace(prompt.trim(), ''),
        naturalnessUpgrade: prompt,
        corePrompt,
        deprecatedBehavior: baseBehavior,
        replacements,
    });
    assert.ok(installedFromMissing.expectedPrompt.startsWith(prompt.trim().replace(/\r\n?/g, '\n')));
    assert.equal(
        installedFromMissing.expectedPrompt.split(AMY_CONVERSATION_START_MARKER).length - 1,
        1,
    );
});

test('Amy conversation block installer refuses malformed managed markers', () => {
    assert.throws(
        () => installAmyConversationBlock(`${AMY_CONVERSATION_START_MARKER}\nbroken`, prompt),
        /markers are malformed/i,
    );
    assert.throws(
        () => installAmyConversationBlock(
            `${AMY_CONVERSATION_START_MARKER}\none\n${AMY_CONVERSATION_END_MARKER}\n${AMY_CONVERSATION_START_MARKER}\ntwo\n${AMY_CONVERSATION_END_MARKER}`,
            prompt,
        ),
        /markers are malformed/i,
    );
    assert.throws(
        () => installAmyConversationBlock('BASE PROMPT', 'replacement without managed markers'),
        /markers are malformed/i,
    );
    assert.throws(
        () => installAmyConversationBlock(
            'BASE PROMPT',
            `${AMY_CONVERSATION_END_MARKER}\nmisordered\n${AMY_CONVERSATION_START_MARKER}`,
        ),
        /markers are malformed/i,
    );
    assert.throws(
        () => installAmyConversationBlock('BASE PROMPT', `${prompt}\n${AMY_CONVERSATION_START_MARKER}\nduplicate\n${AMY_CONVERSATION_END_MARKER}`),
        /markers are malformed/i,
    );
});

test('Amy core installer fails closed on malformed or ambiguous prompt boundaries', () => {
    assert.throws(
        () => installAmyCoreBlock('BASE PROMPT', 'replacement without core markers'),
        /local Amy core prompt markers are malformed or missing/i,
    );
    assert.throws(
        () => installAmyCoreBlock(
            `${corePrompt}\n${corePrompt}`,
            corePrompt,
        ),
        /live Amy core prompt markers are malformed/i,
    );
    assert.throws(
        () => installAmyCoreBlock(
            'AMY — INSIGHT ENTERPRISE SDR\nANAM SYSTEM PROMPT\nVERSION: AMY_ANAM_V2_2026_07_15\nlegacy without a Workbench boundary',
            corePrompt,
        ),
        /legacy core boundary is malformed/i,
    );
    assert.throws(
        () => installAmyCoreBlock(
            [
                'AMY — INSIGHT ENTERPRISE SDR',
                'ANAM SYSTEM PROMPT',
                'VERSION: AMY_ANAM_V2_2026_07_15',
                'legacy one',
                'AMY — INSIGHT ENTERPRISE SDR',
                'ANAM SYSTEM PROMPT',
                'VERSION: AMY_ANAM_V2_2026_07_15',
                '<!-- AMY_WORKBENCH_START -->',
            ].join('\n'),
            corePrompt,
        ),
        /legacy core anchor is missing or duplicated/i,
    );
});

test('Amy has one canonical Insight greeting and a hard spoken ceiling', () => {
    assert.match(prompt, /Hi, I'm Amy with Insight Enterprises\. Who am I speaking with today\?/);
    assert.match(prompt, /After the visitor gives only a name.*acknowledge it naturally and ask one clean discovery question/s);
    assert.match(prompt, /same turn also contains an evaluation or capability request.*answer it immediately/is);
    assert.match(prompt, /Finish the sentence and thought/i);
    assert.match(prompt, /hard ceiling of forty-five spoken words.*request for detail may approach sixty/is);
    assert.match(reliabilityPrompt, /configured greeting is exact and complete/i);
    assert.match(reliabilityPrompt, /do not ask for the name a second time/i);
    assert.doesNotMatch(reliabilityPrompt, /ask exactly, "What name would you like me to use\?"/i);
    assert.match(workbenchUpdater, /AMY_INITIAL_MESSAGE/);
    assert.match(workbenchUpdater, /initialMessage: AMY_INITIAL_MESSAGE/);
    assert.match(reliabilityPrompt, /website check-in already authorizes the standard follow-up bundle/i);
    assert.match(reliabilityPrompt, /closing intent wins.*do not delay the close/s);
    assert.match(reliabilityPrompt, /that's a wrap.*hard close/i);
    assert.match(reliabilityPrompt, /Before we wrap.*not a close/i);
    assert.match(prompt, /similar customer example, case study.*evidence request/is);
    assert.match(prompt, /Never substitute a conversation-generated Workbench view for customer proof/i);
    assert.match(workbenchPrompt, /never call show_visual_brief solely for customer proof/i);
});

test('Amy separates AI interest from a pilot and preserves the CJIS boundary', () => {
    assert.match(prompt, /Interest in AI is not a pilot/i);
    assert.match(prompt, /What would you do if you were me.*does not expand Amy's authority/s);
    assert.match(prompt, /non-sensitive.*do not prove.*outside the CJIS boundary/s);
    assert.match(publicSectorPrompt, /administrative.*non-sensitive.*not case files.*does not establish.*outside the CJIS boundary/s);
    assert.match(reliabilityPrompt, /That's what I needed.*not explicit closing intent/s);
});

test('Amy closes with an outcome motion and relies on check-in-authorized follow-up', async () => {
    const emailPrompt = await readFile(new URL('../config/anam/amy-agentmail-prompt-upgrade.md', import.meta.url), 'utf8');
    const emailTool = JSON.parse(await readFile(new URL('../config/anam/amy-agentmail-client-tool.json', import.meta.url), 'utf8'));
    assert.match(reliabilityPrompt, /soft close.*wrap it here.*closing motion/is);
    assert.match(reliabilityPrompt, /soft close.*Call `end_amy_session` silently.*only once.*closing_motion_and_farewell_required/is);
    assert.match(reliabilityPrompt, /priority, the confirmed boundary, and the next human validation/i);
    assert.match(reliabilityPrompt, /session follow-up will arrive at the private check-in address/i);
    assert.match(reliabilityPrompt, /closing_motion_and_farewell_required.*end with exactly.*Thanks for talking this through with me\. Take care\./is);
    assert.match(reliabilityPrompt, /close_in_progress.*say nothing and never call the tool again/is);
    assert.match(reliabilityPrompt, /soft close never requires a second call/i);
    assert.doesNotMatch(reliabilityPrompt, /closing_motion_required\b/i);
    assert.doesNotMatch(reliabilityPrompt, /then silently call `end_amy_session` again/i);
    assert.match(reliabilityPrompt, /Never offer email, ask email permission.*solicit a phone number/is);
    assert.match(reliabilityPrompt, /hard close.*goodbye.*skips the closing motion/is);
    assert.match(emailPrompt, /authorizes the standard post-session email bundle at website check-in/i);
    assert.match(emailPrompt, /Never offer email, ask permission to send it.*ask the visitor to confirm contact information/is);
    assert.match(emailPrompt, /speaks or spells an email address.*do not parse it, reconstruct it, repeat it, correct it, or store it/is);
    assert.match(emailPrompt, /Spoken words such as "at," "at symbol," or "dot".*never update/is);
    assert.match(emailPrompt, /Do not call send_follow_up_email for the standard email bundle/i);
    assert.match(emailPrompt, /Do not pause for confirmation and do not ask for a phone number/i);
    assert.match(emailPrompt, /call `end_amy_session` exactly once before speaking.*closing_motion_and_farewell_required/is);
    for (const source of [reliabilityPrompt, emailPrompt]) {
        assert.doesNotMatch(source, /closing_motion_required\b/i);
        assert.doesNotMatch(source, /call `?end_amy_session`? after the concise outcome recap/i);
        assert.doesNotMatch(source, /then silently call `end_amy_session` again/i);
    }
    assert.match(workbenchUpdater, /amy-agentmail-client-tool\.json/);
    assert.match(workbenchUpdater, /amy-agentmail-prompt-upgrade\.md/);
    assert.match(workbenchUpdater, /AMY_AGENTMAIL_START/);
    assert.ok(emailTool.config.parameters.properties.callbackPhone);
    assert.ok(emailTool.config.parameters.properties.callbackPhoneConfirmed);
    assert.equal(emailTool.config.parameters.properties.userConfirmed, undefined);
    assert.deepEqual(emailTool.config.parameters.required, ['callbackPhone', 'callbackPhoneConfirmed']);
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
