import {isolatedRuntime} from './isolated-capture-application.mjs';
const parse=x=>typeof x==='string'?JSON.parse(x):x;
export async function readAmyAnamLaunch(id){const r=isolatedRuntime();if(!r||id!==r.binding.launchId)return null;
 return parse(await r.command(['GET','xagent:amy:anam:launch:v1:'+id]));}
export async function readAmyAnamSession(id){const r=isolatedRuntime();if(!r||id!==r.binding.sessionId)return null;
 return parse(await r.command(['GET','xagent:amy:anam:session:v1:'+id]));}
export async function consumeAmyAnamDistributedRateLimit(_input){const r=isolatedRuntime();if(!r)return {allowed:false};
 const now=Date.now(),times=(r.rate.get('fixture')??[]).filter(t=>now-t<30*60*1000);times.push(now);r.rate.set('fixture',times);
 return {allowed:times.length<=80};}
