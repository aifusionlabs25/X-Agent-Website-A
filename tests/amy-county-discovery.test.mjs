import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAmyWorkbenchModel, diffAmyWorkbenchFacts} from '../lib/anam/workbench-v2.ts';
import {buildAmyEmailBundle} from '../lib/anam/agentmail-templates.ts';
import {hasExplicitAmyCloseIntent, hasAmySoftCloseIntent, createAmyFarewellCloseCoordinator} from '../lib/anam/amy-session-close.ts';
import {readAmyQualificationFacts} from '../lib/anam/amy-qualification-facts.ts';
import {countyTurns} from './fixtures/amy-county-discovery.mjs';
const build = turns => buildAmyWorkbenchModel(turns, '', '', 'roadmap');
const fact = (m, label) => m.facts.find(f=>f.label===label)?.value || '';

test('county replay produces public-sector facts, never educational inventions', () => {
    const m=build(countyTurns);
    assert.equal(m.lane,'Public-sector modernization');
    assert.doesNotMatch(JSON.stringify([m.facts,m.brief,m.roadmap,m.visualBrief]), /student|SIS fields|three-day|education/i);
    assert.match(fact(m,'Infrastructure status'), /funded.*aging systems/);
    assert.match(fact(m,'Technology context'), /Servers.*Storage/);
    assert.match(fact(m,'Critical workloads'), /Case processing.*Approval workflows/);
    assert.match(fact(m,'Reported data category'), /Criminal justice information.*unvalidated/);
    assert.match(fact(m,'Governance drivers'), /visitor said CJS.*State-level data privacy/);
    assert.match(fact(m,'AI data-flow review'), /haven't reviewed/);
    assert.match(fact(m,'Timing'), /haven't fully aligned/);
    assert.doesNotMatch(fact(m,'Primary guardrail'), /budget/);
    assert.match(m.brief.nextStep,/before deciding.*together or separately/);
});

test('first funding-note request is retained as an open item and produces a visible delta', () => {
    const before=build(countyTurns.slice(0,8));
    const after=build(countyTurns.slice(0,9));
    assert.match(fact(after,'AI funding'), /Unconfirmed:.*confirm funding sources/);
    assert.ok(diffAmyWorkbenchFacts(before,after).some(c=>c.label==='AI funding'&&c.kind==='added'));
    assert.ok(after.roadmap.facts.some(f=>f.label==='AI funding'));
    assert.match(after.brief.openQuestions[0],/funding source/);
    const final=build(countyTurns);
    assert.match(fact(final,'AI funding'),/Unconfirmed:.*operational budget/);
    assert.equal(final.brief.objective, before.brief.objective);
});

test('all email lanes retain qualification details and unconfirmed funding', () => {
    const bundle=buildAmyEmailBundle({model:build(countyTurns),turns:countyTurns,displayName:'Demo Visitor',verifiedEmail:'visitor@example.com',externalSessionId:'county-regression',sessionStartedAt:'2026-09-02T19:44:58Z',sessionEndedAt:'2026-09-02T19:50:54Z'});
    for(const message of [bundle.visitor,bundle.admin,bundle.intake]) {
        assert.match(message.text,/Public-sector modernization|infrastructure upgrade/);
        for(const pattern of [/funded/,/operational budget/,/criminal justice information/i,/haven't reviewed/,/haven't fully aligned/,/case processing/i]) assert.match(message.text,pattern);
        assert.doesNotMatch(message.text,/Education AI|student-risk|non-negotiable guardrail:.*budget/i);
    }
    assert.equal(bundle.visitor.attachments,undefined);
});

test('industry classification requires actual educational context, not upgrade or grade substrings', () => {
    for(const content of ['We need a server upgrade.', 'We need an enterprise-grade platform.', 'Our county needs an infrastructure upgrade.', 'The warehouse upgrade uses rugged scanners.']) assert.notEqual(build([{role:'user',content}]).lane,'Education AI discovery');
    const education=build([{role:'user',content:'Our university wants AI to improve course scheduling.'}]);
    assert.equal(education.lane,'Education AI discovery');
    assert.doesNotMatch(JSON.stringify(education.roadmap),/three-day|SIS fields|student-risk/);
});

test('funding unknowns and corrections never silently become approvals or cross-workstream facts', () => {
    let q=readAmyQualificationFacts(['The infrastructure upgrade is funded.','We need to confirm the AI funding source.']);
    assert.equal(q.fundingOpen,true);
    q=readAmyQualificationFacts(['The AI budget is approved.','The AI budget is not yet confirmed.']);
    assert.equal(q.fundingOpen,true);
    assert.match(q.funding,/Unconfirmed/);
    q=readAmyQualificationFacts(['The infrastructure refresh is unfunded.','The AI budget is confirmed by finance.']);
    assert.match(q.infrastructureStatus,/unfunded/);
    assert.equal(q.fundingOpen,false);
    assert.match(q.funding,/Visitor-reported/);
    assert.equal(readAmyQualificationFacts(['The infrastructure upgrade is funded.','The funding source is undetermined.']).funding,'');
});

test('assistant or tool prose cannot manufacture qualification details', () => {
    const m=buildAmyWorkbenchModel([{role:'user',content:'Show a roadmap.'},{role:'agent',content:'The infrastructure upgrade is funded. AI funding is approved.'}], 'Our data includes criminal justice information.');
    assert.equal(fact(m,'Infrastructure status'),'');
    assert.equal(fact(m,'AI funding'),'');
    assert.equal(fact(m,'Reported data category'),'');
});

test('questions and hypothetical data reviews are not recorded as completed facts', () => {
    for (const content of ['Have our AI data flows been reviewed?', 'If the AI data flows were reviewed, could we proceed?', 'Our data includes criminal justice information?']) {
        const q=readAmyQualificationFacts([content]);
        assert.equal(q.dataReview,'');
        assert.equal(q.criminalJusticeData,false);
    }
});

test('polite farewell variants close, while quoted and pending requests remain open', () => {
    for(const s of [countyTurns[11].content,'Have a nice day.','Enjoy your weekend.','Thanks, have a wonderful evening.','Have a great day, Amy.']) assert.equal(hasExplicitAmyCloseIntent(s),true,s);
    for(const s of [countyTurns[10].content,countyTurns[12].content,'If I say have a great day, will you end the call?','Before we end, could you show the roadmap? Have a great day.',"Don't end the call. Have a great day.",'Have a great day. Can you show the brief first?']) {
        assert.equal(hasExplicitAmyCloseIntent(s),false,s);
        assert.equal(hasAmySoftCloseIntent(s),false,s);
    }
});

test('accepted farewell drains once and cannot be rearmed by subsequent test-bot chatter', () => {
    let stops=0; let id=0; const timers=new Map();
    const c=createAmyFarewellCloseCoordinator({stopStreaming:()=>stops++,schedule:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},cancel:id=>timers.delete(id)});
    assert.ok(hasExplicitAmyCloseIntent(countyTurns[11].content));
    c.arm();c.completeFarewell();assert.equal(c.arm(),false);
    [...timers.values()].find(t=>t.ms===2500).fn();
    assert.equal(stops,1);assert.equal(c.arm(),false);
});
