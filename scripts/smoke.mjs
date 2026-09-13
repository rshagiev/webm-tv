import {spawn,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const child=spawn(process.execPath,['scripts/start.mjs'],{env:{...process.env,HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
let output='';
child.stdout.on('data',b=>{output+=b;});
child.stderr.on('data',b=>{output+=b;});
try {
 const deadline=Date.now()+90000;
 while(!output.includes('WebM TV is ready')) {
  if(child.exitCode!==null || Date.now()>deadline) throw new Error(output || 'Server did not start');
  await new Promise(r=>setTimeout(r,100));
 }
 const health=await fetch('http://127.0.0.1:4173/api/health');assert.equal(health.status,200);assert.equal((await health.json()).ok,true);
 const page=await fetch('http://127.0.0.1:4173/');assert.equal(page.status,200);const html=await page.text();assert.match(html,/WebM TV/);
 const asset=html.match(/src="(\/assets\/[^\"]+\.js)"/);assert.ok(asset);assert.equal((await fetch('http://127.0.0.1:4173'+asset[1])).status,200);
 const blocked=await fetch('http://127.0.0.1:4173/api/health',{headers:{Origin:'http://example.com'}});assert.equal(blocked.status,403);
 const systemResponse=await fetch('http://127.0.0.1:4173/api/system');
 assert.match(systemResponse.headers.get('cache-control'),/no-store/);
 const system=await systemResponse.json();assert.equal(system.localhost,'http://localhost:4173');assert.deepEqual(system.lan,[]);assert.ok(system.shutdownToken);
 const denied=await fetch('http://127.0.0.1:4173/api/shutdown',{method:'POST'});assert.equal(denied.status,403);
 const foreign=await fetch('http://127.0.0.1:4173/api/shutdown',{method:'POST',headers:{Origin:'http://example.com','X-WebMTV-Shutdown':system.shutdownToken}});assert.equal(foreign.status,403);
 const shutdown=await fetch('http://127.0.0.1:4173/api/shutdown',{method:'POST',headers:{'X-WebMTV-Shutdown':system.shutdownToken}});assert.equal(shutdown.status,200);
 const end=Date.now()+10000;
 while(child.exitCode===null && Date.now()<end) await new Promise(r=>setTimeout(r,100));
 assert.equal(child.exitCode,0,'launcher must exit after server shutdown');
 await assert.rejects(fetch('http://127.0.0.1:4173/api/health',{signal:AbortSignal.timeout(1000)}));
 console.log('PASS: launcher, page, built asset, addresses, shutdown authorization and process exit');
} catch(error) {console.error(error);process.exitCode=1;}
finally {if(process.platform==='win32') spawnSync('taskkill',['/pid',String(child.pid),'/T','/F']);else child.kill('SIGTERM');}
