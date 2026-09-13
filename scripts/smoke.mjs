import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
let output='';
child.stdout.on('data',b=>{output+=b;});
child.stderr.on('data',b=>{output+=b;});
try {
 const deadline=Date.now()+15000;
 while(!output.includes('WebM TV is ready')) {
  if(child.exitCode!==null || Date.now()>deadline) throw new Error(output || 'Server did not start');
  await new Promise(r=>setTimeout(r,100));
 }
 const health=await fetch('http://127.0.0.1:4173/api/health');assert.equal(health.status,200);assert.equal((await health.json()).ok,true);
 const page=await fetch('http://127.0.0.1:4173/');assert.equal(page.status,200);const html=await page.text();assert.match(html,/WebM TV/);
 const asset=html.match(/src="(\/assets\/[^\"]+\.js)"/);assert.ok(asset);assert.equal((await fetch('http://127.0.0.1:4173'+asset[1])).status,200);
 const blocked=await fetch('http://127.0.0.1:4173/api/health',{headers:{Origin:'http://example.com'}});assert.equal(blocked.status,403);
 console.log('PASS: server, page, built asset, origin guard');
} catch(error) {console.error(error);process.exitCode=1;}
finally {child.kill('SIGTERM');}
