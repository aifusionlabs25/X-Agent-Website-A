import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAmyWorkbenchModel, diffAmyWorkbenchFacts} from '../lib/anam/workbench-v2.ts';
import {readAmySecurityFacts} from '../lib/anam/amy-security-facts.ts';
import {securityTurns} from './fixtures/amy-security-discovery.mjs';

const fact = (model, label) => model.facts.find(item => item.label === label)?.value || '';
const read = values => readAmySecurityFacts(values);
const build = turns => buildAmyWorkbenchModel(turns);

test('security replay preserves useful visitor facts through live roadmap and finalized replay', () => {
    const live = buildAmyWorkbenchModel(securityTurns.slice(0, 8), '', '', 'roadmap');
    const final = build(securityTurns);
    for (const model of [live, final]) {
        assert.equal(model.lane, 'Security readiness');
        assert.match(fact(model, 'Security findings'), /Outdated encryption.*Privileged-access issues/);
        assert.match(fact(model, 'Affected scope'), /approximately 15 external-facing systems.*admin accounts.*critical/);
        assert.match(fact(model, 'Evidence source'), /Visitor-reported recent gap assessment.*not independently reviewed/);
        assert.match(fact(model, 'Reported audit requirement'), /Visitor-reported TLS 1\.2 minimum.*specialist validation/);
        assert.match(fact(model, 'Governance drivers'), /NIST.*System and communications protection.*Access control.*validation/);
        assert.match(fact(model, 'Accountable team'), /CISO team/);
        assert.match(fact(model, 'Ownership status'), /leads not confirmed/);
        assert.equal(fact(model, 'Primary guardrail'), '');
        assert.match(fact(model, 'Timing'), /state-mandated audit due in 90 days.*not an approved remediation schedule/);
        assert.equal(fact(model, 'Requested output'), 'Two-track roadmap');
        assert.ok(model.roadmap.facts.some(f => f.label === 'Accountable team'));
        assert.doesNotMatch(JSON.stringify(model.roadmap), /Demo Visitor/);
        assert.ok(model.brief.openQuestions.some(q => /individual leads/.test(q)));
        assert.doesNotMatch(model.brief.openQuestions.join(' '), /Who should be involved|Which environment/);
    }
    assert.deepEqual(live.roadmap, final.roadmap);
});

test('actual roadmap renders two bounded scope reviews instead of inventing parallel delivery', () => {
    const model = build(securityTurns);
    assert.match(model.roadmap.title, /Encryption \+ privileged access.*proposed workstreams/);
    assert.deepEqual(model.roadmap.phases.map(p => p.title), [
        'Confirm audit evidence and ownership',
        'Encryption workstream — scope review',
        'Privileged-access workstream — scope review',
        'Validate dependencies before sequencing',
    ]);
    assert.match(model.roadmap.phases[1].detail, /15.*TLS 1\.2 minimum.*no rollout is approved/);
    assert.match(model.roadmap.phases[2].detail, /admin accounts.*critical.*smaller scope does not establish/);
    assert.match(model.roadmap.phases[3].detail, /whether parallel work is feasible/);
    assert.match(model.brief.nextStep, /validate the gap assessment.*modernization.*before agreeing/);
});

test('assistant and tool supplied details are never used as security evidence', () => {
    const invented = securityTurns.map(t => ({role:'agent',content:t.content}));
    const model = buildAmyWorkbenchModel([{role:'user',content:'Please show the roadmap.'}, ...invented], securityTurns.map(t=>t.content).join(' '));
    for (const label of ['Security findings','Affected scope','Reported audit requirement','Accountable team','Ownership status','Evidence source']) assert.equal(fact(model,label),'');
});

test('plain-English security paraphrases retain reported scope, evidence, team and unresolved leads', () => {
    const model = build([
        'We completed a security assessment. It identified encryption gaps and privileged-access issues.',
        'The encryption finding covers roughly 20 internet-facing applications.',
        'The privileged-access findings affect administrator accounts, smaller scope but critical.',
        'Our security team is responsible for both. Individual leads are not yet assigned.',
        'The audit deadline is in 60 days.',
        'Yes, a phased roadmap would be helpful.',
    ].map(content=>({role:'user',content})));
    assert.match(fact(model,'Affected scope'), /20 internet-facing.*admin accounts.*critical/);
    assert.match(fact(model,'Accountable team'), /security team/);
    assert.match(fact(model,'Ownership status'), /not confirmed/);
    assert.match(fact(model,'Timing'), /audit due in 60 days/);
    assert.equal(fact(model,'Requested output'),'Two-track roadmap');
});

test('questions, hypotheticals, and unknown owner ASR cannot become affirmed security facts', () => {
    for (const text of [
        'Do we have outdated encryption and privileged access issues?',
        'If the encryption gap affects around 15 external-facing systems, would we need a roadmap?',
        'Could the audit require TLS 1.2 minimum?',
        'Would the CISO team own both?',
        "I'll see if Sarah agrees with the decision.",
        'The security team might own both and our audit might be due in 90 days.',
    ]) {
        const result=read([text]);
        for(const key of ['findings','affectedScope','requirement','accountableTeam','auditDeadline']) assert.equal(result[key],'', `${key}: ${text}`);
    }
});

test('correction, retraction and unresolved scope replace or remove stale security assertions', () => {
    const values=securityTurns.map(t=>t.content);
    const updated=read([...values, 'Correction: the encryption gap affects 12 internal-facing systems, not 15 external-facing systems.']);
    assert.match(updated.encryptionScope,/12 internal-facing/);
    assert.doesNotMatch(updated.encryptionScope,/15|external/);
    assert.match(updated.findings,/Outdated encryption/);
    assert.equal(updated.hasTwoWorkstreams,true);
    const retracted=read([...values, 'There are no encryption gaps. The privileged access issues were resolved. The CISO team does not own this.']);
    assert.equal(retracted.findings,'');
    assert.equal(retracted.affectedScope,'');
    assert.equal(retracted.requirement,'');
    assert.equal(retracted.accountableTeam,'');
    const unknown=read([...values, 'The encryption scope is not confirmed. The audit deadline is unknown.']);
    assert.equal(unknown.encryptionScope,'');
    assert.equal(unknown.auditDeadline,'');
    const unknownModel=build([...securityTurns, {role:'user', content:'The audit deadline is unknown.'}]);
    assert.match(fact(unknownModel,'Timing'), /requires reconfirmation/);
    assert.doesNotMatch(fact(unknownModel,'Timing'), /90/);
    const scopeOnly=read([...values,'The encryption gap does not affect external-facing systems.']);
    assert.equal(scopeOnly.encryptionScope,'');
    assert.match(scopeOnly.encryptionFinding,/Outdated encryption/);
    assert.equal(scopeOnly.hasTwoWorkstreams,true);
});

test('TLS values and audit deadlines update from visitor corrections, not assistant recommendations', () => {
    const before=build(securityTurns);
    const after=build([...securityTurns, {role:'user',content:'Correction: the audit requires TLS 1.3 minimum. The audit deadline is now in 120 days.'}]);
    assert.match(fact(after,'Reported audit requirement'),/TLS 1\.3 minimum/);
    assert.doesNotMatch(fact(after,'Reported audit requirement'),/TLS 1\.2/);
    assert.match(fact(after,'Timing'),/120 days/);
    assert.ok(diffAmyWorkbenchFacts(before,after).some(c=>c.label==='Reported audit requirement' && c.kind==='updated'));
});

test('requested output survives affirmative road-map phrasing but not withdrawal, quotation or email-only request', () => {
    assert.equal(fact(build([{role:'user',content:'Yes, a phased road map would help.'}]),'Requested output'),'Roadmap');
    assert.equal(fact(build([{role:'user',content:'Show me the Visual Brief and email it after the session.'}]),'Requested output'),'Visual brief');
    for (const text of ['Do not show a roadmap.', 'Please explain the word roadmap.', 'If I say "show a roadmap", what happens?', 'Could you email me the roadmap summary?', 'We discussed a roadmap yesterday.']) assert.equal(fact(build([{role:'user',content:text}]),'Requested output'),'',text);
    const withdrawn=build([{role:'user',content:'Yes, a phased roadmap would be helpful.'},{role:'user',content:'Actually, skip the roadmap.'}]);
    assert.equal(fact(withdrawn,'Requested output'),'');
});

test('one reported finding does not create a second security workstream or a remediation approval', () => {
    const model=build([{role:'user',content:'Our gap assessment shows outdated encryption. Please show a roadmap.'}]);
    assert.doesNotMatch(JSON.stringify([model.facts,model.roadmap]), /privileged-access|Privileged access/);
    assert.match(model.roadmap.phases[1].title,/Encryption workstream/);
    assert.match(model.roadmap.phases[2].detail,/Do not infer a separate second finding/);
});
