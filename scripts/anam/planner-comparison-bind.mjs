// Prompt-only publication/restoration using the existing James PUT contract.
// Never creates a persona, starts a session, or changes voice/tools/Knowledge.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const mode=process.argv[2];if(!['publish','restore','verify'].includes(mode))throw Error('Explicit publish/restore/verify required');
process.loadEnvFile('C:/AI Fusion Labs/X AGENTS/REPOS/x-agent-website-a/.env.local');
const dir=new URL('../../.vercel/comparison/',import.meta.url),id='ff9c480e-44d1-4a8c-8ae6-b5666fd2a92d';
const sha=s=>createHash('sha256').update(s).digest('hex');
const base=fs.readFileSync(new URL('baseline-prompt.txt',dir),'utf8'),neutral=fs.readFileSync(new URL('neutral-prompt.txt',dir),'utf8');
const protectedConfig=p=>({id:p.id,name:p.name,voiceId:p.voice?.id,llmId:p.llmId,tools:p.tools,avatarId:p.avatar?.id,avatarModel:p.avatarModel,
  initialMessage:p.initialMessage,skipGreeting:p.skipGreeting,uninterruptibleGreeting:p.uninterruptibleGreeting,languageCode:p.languageCode,
  directorNotes:p.directorNotes,voiceDetectionOptions:p.voiceDetectionOptions,enableAudioPassthrough:p.enableAudioPassthrough,zeroDataRetention:p.zeroDataRetention});
const request=async(path,body)=>{const r=await fetch('https://api.anam.ai/v1'+path,{method:body?'PUT':'GET',headers:{Authorization:'Bearer '+process.env.ANAM_API_KEY,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('Anam configuration '+r.status);return r.json();};
const before=await request('/personas/'+id),beforeHash=sha(before.brain.systemPrompt);
if(mode==='verify'){console.log(JSON.stringify({promptHash:beforeHash,voice:before.voice?.displayName,awaitResult:before.tools.find(t=>t.name==='james_handoff')?.awaitResult,timeout:before.tools.find(t=>t.name==='james_handoff')?.toolTimeoutSeconds}));process.exit(0);}
const expected=mode==='publish'?sha(base):sha(neutral),target=mode==='publish'?neutral:base;
if(beforeHash!==expected)throw Error('Prompt changed outside comparison; will not overwrite');
if(mode==='publish'){
 const tool=before.tools.find(t=>t.name==='james_handoff');
 if(before.voice?.id!=='5ea79b27-25e5-52d9-bab8-944038935c40'||tool.awaitResult!==true||tool.toolTimeoutSeconds!==15)throw Error('Persona binding changed');
}
// A durable attempt marker prevents an uncertain publication from auto-retrying.
fs.writeFileSync(new URL(mode+'-intent.json',dir),JSON.stringify({at:new Date().toISOString(),beforeHash,targetHash:sha(target),protected:protectedConfig(before)},null,2),{flag:'wx'});
await request('/personas/'+id,{systemPrompt:target});
const after=await request('/personas/'+id);
if(sha(after.brain.systemPrompt)!==sha(target)||JSON.stringify(protectedConfig(before))!==JSON.stringify(protectedConfig(after)))throw Error('Exact readback/preservation failed; stop and inspect');
const receipt={at:new Date().toISOString(),mode,promptHash:sha(after.brain.systemPrompt),protectedConfigHash:sha(JSON.stringify(protectedConfig(after))),onlySystemPromptChanged:true};
fs.writeFileSync(new URL(mode+'-receipt.json',dir),JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify(receipt));
