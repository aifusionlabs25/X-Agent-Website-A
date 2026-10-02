import { notFound } from 'next/navigation';
import JamesCanary from '@/components/james/JamesCanary';
import { emptyIntake, applyTurn, view, receipt, CURRENT_JAMES_PERSONA_ID } from '@/lib/james-canary/state';
import type { Session } from '@/lib/james-canary/state';
import { finalizeBrief, applyBriefCorrection, confirmBrief } from '@/lib/james-canary/structured-brief';

// Local development only. Fictional fixtures exercise the actual reducer; no
// microphone, provider tokens, external calls, email or runtime test backdoors.
export default function Page() {
    if (process.env.NODE_ENV !== 'development') notFound();
    let session: Session = {id:'17e1b181-d4fa-42eb-8209-cad30ef97880',browserId:'local-preview',clientLabel:'local-fictional-preview',
        createdAt:'2026-10-01T20:00:00.000Z',revision:0,stateHash:'preview',personaId:CURRENT_JAMES_PERSONA_ID,
        config:{promptHash:'preview',configHash:'preview',voiceId:'preview',voiceName:'Local preview — no call'},
        state:'ACTIVE',turns:[],intake:emptyIntake(),intakeBrief:{version:2},receipts:[]};
    let sequence=0;
    const add=(content:string,role:'user'|'persona'='user')=>{
        const turn={id:String(++sequence),role,content};
        session=receipt(session,applyTurn(session,turn),turn);
    };
    const states:{label:string;state:ReturnType<typeof view>|null}[]=[{label:'James only',state:null}];
    add('Hello.');add('Go on.');states.push({label:'Greetings — pad still hidden',state:view(session)});
    add('Hey, so my landlord shut off my water.');states.push({label:'First fact — automatic split view',state:view(session)});
    add('When did this happen?','persona');add('September 30th.');
    add('Where did this happen?','persona');add('Phoenix.');
    add('What are you hoping the attorney can help you with?','persona');add('I want help understanding my options.');
    add('What is your full name?','persona');add("It's Avery Sample.");
    add('My name is Avery Sample. Is that correct?','persona');add('Yes.');
    add('What is your callback number?','persona');add('480-555-0194.');
    add('Your callback number is 480-555-0194. Is that correct?','persona');add('Yes.');
    add('What is your email address?','persona');add('avery at example.test');
    add('Your email is avery at example dot test. Is that correct?','persona');add('Yes.');
    states.push({label:'Structured intake — ready for review',state:view(session)});
    session=finalizeBrief(session);session=applyBriefCorrection(session,'name','Avery Monroe',view(session).intakeBrief!.hash);
    states.push({label:'Correction applied — new review required',state:view(session)});
    session=confirmBrief(session,view(session).intakeBrief!.hash);
    states.push({label:'Visitor confirmed current version',state:view(session)});
    return <JamesCanary notepadDemo launchReady={false} storageKey="james-local-brief-preview" previewStates={states}/>;
}
