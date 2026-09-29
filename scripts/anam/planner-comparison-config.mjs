// Bounded setup/readback only. No inference, session start, or email operation.
import fs from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
const root=new URL('../../',import.meta.url), dir=new URL('.vercel/comparison/',root);
fs.mkdirSync(dir,{recursive:true});
process.loadEnvFile('C:/AI Fusion Labs/X AGENTS/REPOS/x-agent-website-a/.env.local');
const id='ff9c480e-44d1-4a8c-8ae6-b5666fd2a92d';
const sha=s=>createHash('sha256').update(s).digest('hex');
const get=async()=>{const r=await fetch('https://api.anam.ai/v1/personas/'+id,{headers:{Authorization:'Bearer '+process.env.ANAM_API_KEY}});if(!r.ok)throw Error('Persona read '+r.status);return r.json();};
const p=await get();
const prompt=p.brain?.systemPrompt;
const tool=p.tools.find(t=>t.name==='james_handoff');
if(sha(prompt)!=='22256e741fb60f8548efdf22200024f145c5f32703460331d4bbf711443404ce'||tool.awaitResult!==true||tool.toolTimeoutSeconds!==15)throw Error('Baseline changed; stop');
const safe={id:p.id,name:p.name,systemPrompt:prompt,voice:p.voice,brain:p.brain,tools:p.tools,llmId:p.llmId,initialMessage:p.initialMessage,
  publishedAt:p.publishedAt,updatedAt:p.updatedAt,voiceDetectionOptions:p.voiceDetectionOptions,expressivity:p.expressivity,
  skipGreeting:p.skipGreeting,uninterruptibleGreeting:p.uninterruptibleGreeting,avatarId:p.avatar?.id,languageCode:p.languageCode};
// Select configured properties only; no API credentials or signed media URLs.
safe.voice={id:p.voice.id,displayName:p.voice.displayName};
const write=(name,value)=>fs.writeFileSync(new URL(name,dir),typeof value==='string'?value:JSON.stringify(value,null,2),{flag:'wx'});
write('baseline.json',safe);write('baseline-prompt.txt',prompt);
const tokens={on:randomBytes(32).toString('base64url'),off:randomBytes(32).toString('base64url')};
write('owner-access.json',tokens);
write('identities.json',{observedAt:new Date().toISOString(),baselineCommit:'bad87a27b9185577fa7feffa846d796a26a2e975',personaId:id,promptHash:sha(prompt),modelId:p.llmId,voice:safe.voice,tools:p.tools.map(t=>({name:t.name,id:t._toolId,type:t.type,awaitResult:t.awaitResult,toolTimeoutSeconds:t.toolTimeoutSeconds,knowledgeFolderId:t.knowledgeFolderId})),armTokenHashes:Object.fromEntries(Object.entries(tokens).map(([k,v])=>[k,sha(v)]))});
console.log(JSON.stringify({personaId:id,promptHash:sha(prompt),voice:safe.voice,awaitResult:tool.awaitResult,timeout:tool.toolTimeoutSeconds,tokenHashes:Object.fromEntries(Object.entries(tokens).map(([k,v])=>[k,sha(v)])),prompt:prompt.split('\n').map((text,index)=>({line:index+1,text})).filter(x=>/conversation_guidance|stage|next_question|missing-item guidance|returned.*question/i.test(x.text))},null,2));
