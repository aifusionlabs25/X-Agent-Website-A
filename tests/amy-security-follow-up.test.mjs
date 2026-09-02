import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAmyWorkbenchModel} from '../lib/anam/workbench-v2.ts';
import {buildAmyEmailBundle} from '../lib/anam/agentmail-templates.ts';
import {renderAmyEmailRoadmap} from '../lib/anam/amy-roadmap-email.ts';
import {securityTurns} from './fixtures/amy-security-discovery.mjs';

const envelope={displayName:'Demo Visitor',verifiedEmail:'typed@example.com',externalSessionId:'security-regression',sessionStartedAt:'2026-09-02T20:28:17Z',sessionEndedAt:'2026-09-02T20:32:37Z',generatedAt:'2026-09-02T20:32:40Z'};
const labels=['Security findings','Affected scope','Reported audit requirement','Accountable team','Ownership status','Evidence source','Governance drivers'];

test('finalized security evidence survives into all three email lanes and the inline roadmap',()=>{
    const model=buildAmyWorkbenchModel(securityTurns);
    const bundle=buildAmyEmailBundle({...envelope,model,turns:securityTurns});
    assert.match(model.facts.find(f=>f.label==='Requested output')?.value||'',/roadmap/i);
    for(const label of labels) {
        const value=model.facts.find(f=>f.label===label)?.value;
        assert.ok(value,`missing ${label}`);
        for(const [lane,email] of Object.entries(bundle)) assert.ok(email.text.includes(value),`${lane} lost ${label}`);
    }
    for(const email of Object.values(bundle)) {
        assert.match(email.text,/YOUR WORKING ROADMAP/);
        for(const phase of model.roadmap.phases) {
            assert.ok(email.text.includes(phase.title));
            assert.ok(email.text.includes(phase.detail));
        }
        assert.match(email.text,/90 days/);
        assert.match(email.text,/specialist validation/);
        assert.equal(email.attachments,undefined);
        assert.doesNotMatch(email.text,/non-negotiable guardrail:.*admin|attached roadmap|faster privileged access/i);
    }
    assert.match(bundle.visitor.html,/#cf0065/);
    assert.match(bundle.visitor.html,/alt="Insight"/);
});

test('organizational accountability is exported without reopening the private Identity section',()=>{
    const model=buildAmyWorkbenchModel(securityTurns);
    model.facts.push({section:'Identity',label:'Stakeholder context',value:'Private Person secret@example.com',status:'mentioned'});
    const bundle=buildAmyEmailBundle({...envelope,model,turns:securityTurns});
    for(const email of Object.values(bundle)) {
        assert.match(email.text,/CISO/i);
        assert.doesNotMatch(email.text+email.html,/Private Person|secret@example\.com/);
    }
    assert.match(bundle.admin.text,/typed@example.com/);
    assert.doesNotMatch(bundle.visitor.text,/typed@example.com/);
});

test('governance is retained even without infrastructure-funding qualification fields',()=>{
    const turns=[{role:'user',content:'Our security readiness review is aligned with NIST.'}];
    const bundle=buildAmyEmailBundle({...envelope,turns,model:buildAmyWorkbenchModel(turns)});
    for(const email of Object.values(bundle)) assert.match(email.text,/Governance drivers: NIST/);
    assert.doesNotMatch(bundle.visitor.text,/YOUR WORKING ROADMAP/);
});

test('operations email labels the bounded transcript excerpt honestly',()=>{
    const turns=[{role:'agent',content:'Hello.'},...securityTurns.flatMap(turn=>[turn,{role:'agent',content:'Acknowledged.'}])];
    const bundle=buildAmyEmailBundle({...envelope,turns,model:buildAmyWorkbenchModel(turns)});
    assert.match(bundle.admin.text,new RegExp(`last 16 of ${turns.length} turns; entries may be shortened`));
    assert.match(bundle.admin.text,new RegExp(`Transcript turns captured: ${turns.length}`));
});

test('inline roadmap rendering is optional and HTML-safe',()=>{
    assert.deepEqual(renderAmyEmailRoadmap(),{html:'',text:''});
    const hostile='<script>alert(1)</script> & "scope"';
    const out=renderAmyEmailRoadmap({title:hostile,outcome:hostile,phases:[{title:hostile,detail:hostile}]});
    assert.doesNotMatch(out.html,/<script>|<iframe/);
    assert.match(out.html,/&lt;script&gt;/);
    assert.match(out.html,/role="presentation"/);
    assert.match(out.text,/no work is approved or scheduled/);
});

test('mixed security and AI discovery keeps late-listed timing, workloads, and separate data sources',()=>{
    const turns=[...securityTurns,
        {role:'user',content:'The infrastructure refresh is funded. The AI funding source is undetermined. We have not reviewed detailed AI data flows. We are a county agency and case management may involve criminal justice information.'},
        {role:'user',content:'Our case management runs in Azure and uses SharePoint and on-prem SQL.'},
        {role:'user',content:'Show the brief.'},
    ];
    const model=buildAmyWorkbenchModel(turns);
    // Exercise the complete bounded schema independently of semantic extraction.
    for(const label of ['Infrastructure status','AI funding','AI data-flow review','Reported data category']) {
        if(!model.facts.some(f=>f.label===label)) model.facts.push({section:'Constraints',label,value:`Reported ${label}`,status:'mentioned'});
    }
    const bundle=buildAmyEmailBundle({...envelope,turns,model});
    assert.match(bundle.visitor.text,/90 days/);
    assert.match(bundle.visitor.text,/Case management/i);
    assert.doesNotMatch(bundle.visitor.text,/YOUR WORKING ROADMAP/);
    for(const lane of ['admin','intake']) {
        assert.match(bundle[lane].text,/recent gap assessment/);
        assert.match(bundle[lane].text,/Visitor-identified data: SharePoint.*permissible use not validated.*On-premises SQL/);
    }
});
