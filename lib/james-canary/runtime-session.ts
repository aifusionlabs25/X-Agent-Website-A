import { createHash } from 'node:crypto';
import type { AnamSessionMetadata } from '../anam/session-api.ts';
export const RUNTIME_CANDIDATE_ID='016e2c66-166b-43bd-8ebf-70b56c46575c';
const PROMPT_HASH='4ff9a5aee9a23b95e1b8c85b7c3ac67869424fff319d786a1aadacbe4958b1b7';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
type Tool={name:string;type:string;_toolId?:string;[key:string]:unknown};
type Candidate={id:string;name:string;brain:{systemPrompt:string};avatar:{id:string};avatarModel:string;voice:{id:string;providerVoiceId:string;providerModelId:string};llmId:string;tools:Tool[];[key:string]:unknown};
export type RuntimeBinding={promptHash:string;llmId:string;avatarVersion:string;avatarEngineKey:string;ttsProviderVoiceId:string;ttsProviderModelId:string;tools:Tool[];settings:Record<string,unknown>};
const settings=['skipGreeting','uninterruptibleGreeting','initialMessage','zeroDataRetention','directorNotes','voiceDetectionOptions','voiceGenerationOptions','enableAudioPassthrough'] as const;
function stable(value:unknown):string {
    if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}';
    return JSON.stringify(value);
}
// Verification evidence only; never used to construct a retrieval request.
// Independently inventoried candidate folder: PRE_RAG_REFINEMENT.json,
// candidateKb (2026-10-03). Unknown/new folder mappings fail closed.
const candidateFolder='cca7a89f-fd89-45bd-a805-3c2dbd5bf4e0';
const candidateDocuments=[
    '0c85280d-f3a4-4b16-92f3-ce302dd79b92','4bdbb67e-f465-4b08-90e3-9174b9b79d6e',
    '5c8b610e-26d3-458f-9f1c-f53c9345aa03','6b6ece9a-1ce6-4e64-8301-5d0b7dc4c7a8',
    'a31601c0-8390-4db0-af11-dbfa00a8c0f1','a9b058fc-d4c8-4999-a3f1-204cebdf69a3',
    'c3e50c2c-0592-4f4d-ac89-331d16ab8d40',
];
function resolvedCandidateScope(value:unknown):boolean {
    if(!Array.isArray(value)||value.length!==1)return false;
    const scope=value[0];
    if(!scope||typeof scope!=='object'||Array.isArray(scope)||scope.namespace!==''
        ||Object.keys(scope).some(k=>k!=='namespace'&&k!=='documentIds'))return false;
    const ids=scope.documentIds;
    return Array.isArray(ids)&&ids.length===candidateDocuments.length&&ids.every(id=>typeof id==='string')
        &&stable([...ids].sort())===stable(candidateDocuments);
}
function retainedToolMatches(expected:Tool,actual:Tool):boolean {
    if(!actual||typeof actual!=='object'||Array.isArray(actual))return false;
    const hasScopes=Object.hasOwn(actual,'scopes');
    const scoped=expected.type==='server'&&expected.subtype==='rag'
        &&stable(expected.documentFolderIds)===stable([candidateFolder]);
    if(hasScopes&&(!scoped||!resolvedCandidateScope(actual.scopes)))return false;
    // The provider replaces folder IDs with document scopes. All other fields
    // remain exact; dual-format responses must also retain the correct folder.
    for(const [key,value] of Object.entries(expected)){
        if(key==='documentFolderIds'&&scoped&&hasScopes&&!Object.hasOwn(actual,key))continue;
        if(stable(actual[key])!==stable(value))return false;
    }
    // Anam resolves an omitted interruption setting to false in session
    // metadata. A true or malformed value remains a behavior-affecting drift.
    return Object.keys(actual).every(key=>Object.hasOwn(expected,key)||(key==='scopes'&&scoped)
        ||(key==='disableInterruptions'&&actual[key]===false));
}
export function candidateRuntimeConfig(p:Candidate){
    if(p.id!==RUNTIME_CANDIDATE_ID||hash(p.brain.systemPrompt)!==PROMPT_HASH
        ||p.avatar.id!=='bd18978d-9b78-4072-b8ac-4748c629bbfa'||p.voiceSpeed!==0)
        throw new Error('Candidate baseline drift; runtime-close launch refused');
    if(p.tools.filter(t=>t.name==='end_call'&&t.type==='system').length!==1)throw new Error('Expected native end-call baseline missing');
    const retained=p.tools.filter(t=>!(t.name==='end_call'&&t.type==='system'));
    const toolIds=retained.map(tool=>tool._toolId);
    if(toolIds.some(id=>typeof id!=='string'||!id)||new Set(toolIds).size!==toolIds.length)
        throw new Error('Candidate tool references missing or duplicated; runtime-close launch refused');
    const tools=retained.map(tool=>{const copy={...tool};delete copy._toolId;return copy;});
    const copied=Object.fromEntries(settings.filter(k=>p[k]!==undefined).map(k=>[k,p[k]]));
    const config={name:p.name,avatarId:p.avatar.id,avatarModel:p.avatarModel,voiceId:p.voice.id,llmId:p.llmId,
        systemPrompt:p.brain.systemPrompt,languageCode:p.languageCode,toolIds,...copied};
    const binding:RuntimeBinding={promptHash:hash(p.brain.systemPrompt),llmId:p.llmId,avatarVersion:p.avatarModel,
        avatarEngineKey:'one-shot_H9bKrmW2JXiZ8RuESg82FAXO1E47khXy_james1790216133096',
        ttsProviderVoiceId:p.voice.providerVoiceId,ttsProviderModelId:p.voice.providerModelId,tools,settings:copied};
    return {config,binding};
}
export function verifyCandidateRuntime(metadata:AnamSessionMetadata,expected:{clientLabel:string;createdAt:string;runtimeBinding?:RuntimeBinding}){
    const binding=expected.runtimeBinding,c=metadata.personaConfig as Record<string,unknown>|null;
    if(!binding||!c||metadata.clientLabel!==expected.clientLabel||metadata.personaId!==null||c.type!=='ephemeral')throw new Error('Candidate runtime identity mismatch');
    if(!metadata.startTime||!Number.isFinite(Date.parse(metadata.startTime))||Date.parse(metadata.startTime)<Date.parse(expected.createdAt)-60000)throw new Error('Candidate runtime launch time mismatch');
    if(typeof c.systemPrompt!=='string'||hash(c.systemPrompt)!==binding.promptHash)throw new Error('Candidate runtime prompt mismatch');
    for(const k of ['avatarVersion','avatarEngineKey','ttsProviderVoiceId','ttsProviderModelId'] as const)if(c[k]!==binding[k])throw new Error('Candidate runtime '+k+' mismatch');
    if((c.llmConfig as {id?:unknown}|null|undefined)?.id!==binding.llmId||c.disableBrains!==false||(c.metadata as {client?:string})?.client!=='js-sdk')throw new Error('Candidate runtime model/client mismatch');
    const actualTools=c.tools as Tool[];
    if(!Array.isArray(actualTools)||actualTools.length!==binding.tools.length)throw new Error('Candidate runtime tool count mismatch');
    for(const tool of binding.tools){
        const matches=actualTools.filter(t=>t&&t.name===tool.name);
        if(matches.length!==1||!retainedToolMatches(tool,matches[0]))throw new Error('Candidate runtime retained tool mismatch');
    }
    if(actualTools.some(t=>t.name==='end_call'))throw new Error('Native end-call is still active');
    for(const [key,value] of Object.entries(binding.settings)){
        const runtimeKey=key==='voiceGenerationOptions'?'ttsProviderOptions':key;
        if(stable(c[runtimeKey])!==stable(value))throw new Error('Candidate runtime '+key+' mismatch');
    }
}
