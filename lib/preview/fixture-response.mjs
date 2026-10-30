import {confirmedEvanDisassembly} from '../anam/capture/evan-capture.ts';
import {digest} from '../anam/consumer-bridge.mjs';
import {prefixes} from '../fixture.mjs';
import {CaptureApplicationError as Fault} from '../anam/errors.mjs';
const fact=(category,value,quote,turn=0,extra={})=>({category,value,status:'asserted',location:'unspecified',scope:'',quantity:'',route:null,evidence:[{turn,quote}],...extra});
const base=[fact('inventory','bed','I have one bed',0,{quantity:'one'}),fact('inventory','desk','one desk.',0,{quantity:'one'}),
 fact('question','Do you reassemble either?','Do you reassemble either?'),fact('name','Dana Reyes','My name is Dana Reyes.',1),
 fact('phone','212-555-0174','My phone is 212-555-0174.',1),fact('email','dana@example.test','My email is dana@example.test.',1)];
export async function fixtureResponse(req,meta){
 const revision=meta.binding.revision;
 if(revision<1||revision>5||meta.binding.sourceHash!==digest(prefixes[revision-1]))throw new Fault('PINNED_FICTIONAL_SOURCE_REQUIRED',422);
 if(revision===1)return {facts:structuredClone(base),contactStates:[]};
 if(revision===2)return {facts:[...req.input.previousAccepted.facts,...confirmedEvanDisassembly(req.input.turns,3)],contactStates:[]};
 if(revision===3||revision===4)return {facts:req.input.previousAccepted.facts,contactStates:[],serviceReferences:req.input.serviceEvidence.requiredReferences};
 return {facts:req.input.previousAccepted.facts,contactStates:[{field:'email',state:'REMOVED',questionTurn:null,evidence:[{turn:6,quote:'Remove my email.'}]}]};
}
