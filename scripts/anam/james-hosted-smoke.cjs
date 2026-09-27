// Exactly one real hosted SDK session; synthetic microphone, no email path.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('C:/Users/AI Fusion Labs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url=process.argv[2],folder=process.argv[3];
if(!url?.startsWith('https://')||!folder)throw Error('Hosted URL and fresh evidence directory required');
const log=path.join(folder,'smoke.ndjson');if(fs.existsSync(log))throw Error('Smoke already attempted; no retry');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const retain=value=>{fs.appendFileSync(log,JSON.stringify(value)+'\n');console.log(JSON.stringify(value));};
(async()=>{
    const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:[
        '--no-proxy-server','--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
        '--use-file-for-fake-audio-capture='+path.join(folder,'visitor.wav')]});
    const context=await browser.newContext({permissions:['microphone'],viewport:{width:1440,height:1000}}),page=await context.newPage();
    let id='',final=null,stops=0,startCalls=0;const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',async response=>{
        if(!response.url().includes('/api/james-canary')||response.request().method()!=='POST')return;
        const request=response.request().postDataJSON();
        try {
            const result=await response.json();delete result.sessionToken;
            if(request.action==='start'){startCalls++;id=result.id||'';}
            if(request.action==='begin-close')stops++;
            retain({phase:'API',action:request.action,status:response.status(),request,result});
        }catch(error){retain({phase:'API_DIAGNOSTIC',error:error.message});}
    });
    try {
        await page.goto(url,{waitUntil:'networkidle',timeout:45000});
        await page.screenshot({path:path.join(folder,'before.png'),fullPage:true});
        const start=page.getByRole('button',{name:'Start James',exact:true});assert.equal(await start.count(),1);
        retain({phase:'START',url,audioSha256:hash(fs.readFileSync(path.join(folder,'visitor.wav')))});
        await start.click();
        const deadline=Date.now()+390000;let previousRevision=-1;
        while(Date.now()<deadline){
            await page.waitForTimeout(2500);
            if(errors.length)throw Error('BROWSER_ERROR: '+errors[0]);
            if(id){
                const response=await context.request.get(new URL('/api/james-canary?id='+id,url).href);
                final=await response.json();
                if(final.revision!==previousRevision){retain({phase:'STATE',state:final});previousRevision=final.revision;}
                if(final.state==='CLOSED')break;
            }
            const text=await page.getByRole('status').innerText();
            if(/need attention|does not match|unavailable|failed|not yet verified/i.test(text))throw Error(text);
        }
        assert.equal(startCalls,1);assert.equal(final?.state,'CLOSED');assert.equal(stops,1);
        assert.equal(final.personaId,'ff9c480e-44d1-4a8c-8ae6-b5666fd2a92d');assert.ok(final.providerRelease?.transcriptHash);
        const all=JSON.stringify(final.brief);
        assert.match(all,/Morgan/);assert.match(all,/4805550136/);assert.match(all,/DEFERRED_TO_FIRM/);assert.match(all,/Tempe/);
        assert.ok(['HANDOFF_REQUESTED','PREPARED'].includes(final.handoff));assert.equal(final.email_status,'INACTIVE_NOT_SENT');assert.deepEqual(final.external_actions,[]);
        await page.screenshot({path:path.join(folder,'closed.png'),fullPage:true});
        fs.writeFileSync(path.join(folder,'final.json'),JSON.stringify(final,null,2)+'\n');
        await page.reload({waitUntil:'networkidle'});await page.getByText('Saved closed session restored.',{exact:true}).waitFor();
        const restored=await (await context.request.get(new URL('/api/james-canary?id='+id,url).href)).json();assert.deepEqual(restored,final);
        retain({phase:'PASS',session:id,providerSession:final.providerId,voice:final.config.voiceName,stops,realEmails:0,reload:true});
    }catch(error){
        retain({phase:'BLOCKED',error:error.message,session:id,final,errors});process.exitCode=1;
        await page.screenshot({path:path.join(folder,'blocked.png'),fullPage:true}).catch(()=>{});
        // End this one session via the supported UI; never launch another.
        const end=page.getByRole('button',{name:'End conversation',exact:true});
        if(await end.isEnabled().catch(()=>false)){await end.click();await page.waitForTimeout(10000);}
    }finally{await browser.close();console.log(JSON.stringify({evidence:log,sha256:hash(fs.readFileSync(log))}));}
})().catch(error=>{retain({phase:'HARNESS_BLOCKED',error:error.message});process.exitCode=1;});
