import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,HOST:'127.0.0.1',PUBLIC_ORIGIN:'https://webmtv.example'},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
try {
 const deadline=Date.now()+30000;
 while(!output.includes('WebM TV is ready')) {
  if(child.exitCode!==null || Date.now()>deadline) throw new Error(output);
  await new Promise(r=>setTimeout(r,100));
 }
 const call=(path,init={})=>fetch('http://127.0.0.1:4173/api/'+path,init);
 const system=await (await call('system')).json();
 assert.equal(system.public,true);assert.equal(system.url,'https://webmtv.example');
 assert.equal(system.shutdownToken,undefined);assert.equal(system.lan,undefined);assert.equal(system.localhost,undefined);
 assert.equal((await call('shutdown',{method:'POST'})).status,404);
 assert.equal((await call('feeds',{method:'POST'})).status,404);
 assert.equal((await call('feeds/anything')).status,404);
 assert.equal((await call('health',{headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await call('radio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sources:[]})})).status,400);
 console.log('PASS: public mode, private endpoints disabled, origin guard, invalid request');
} catch(e) { console.error(e);process.exitCode=1; }
finally {child.kill('SIGTERM');}
