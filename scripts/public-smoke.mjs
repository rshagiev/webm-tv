import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const isolatedData = await mkdtemp(join(tmpdir(), "webmtv-smoke-"));
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const clip = {id:'one',board:'test',thread:'1',post:'2',title:'Reply attachment',url:'https://2ch.hk/test/src/1/video.mp4',duration:120,width:640,height:480};
const fixture = {version:1,boards:{test:{at:Date.now(),topics:{'1':{topic:{id:'1',board:'test',title:'Thread',posts:2,files:1,opVideos:0,updated:1},clips:[clip],checkedAt:Date.now()}}}}};
fixture.boards.test.topics['2'] = {topic:{...fixture.boards.test.topics['1'].topic,id:'2'},clips:[],checkedAt:0};
const {createHash} = await import('node:crypto');
await mkdir(join(isolatedData,'cache'));
await writeFile(join(isolatedData,'cache',createHash('sha256').update('https://2ch.hk/index.json').digest('hex')+'.json'),JSON.stringify({at:Date.now(),value:{boards:[{id:'test',name:'Test',category:'Test',file_types:[]}]}}));
await writeFile(join(isolatedData,'library.json'), JSON.stringify(fixture));
const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env, WEBMTV_DATA_DIR: isolatedData,HOST:'127.0.0.1',PUBLIC_ORIGIN:'https://webmtv.example'},stdio:['ignore','pipe','pipe']});
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
 assert.equal((await call('health',{headers:{Origin:'http://127.0.0.1:4173'}})).status,200);
 assert.equal((await call('radio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sources:[]})})).status,400);
 const shared=await call('clips/test/1/video.mp4');
 assert.equal(shared.status,200); assert.deepEqual((await shared.json()).clip,clip);
 assert.equal((await call('clips/test/1/missing.mp4')).status,404);
 assert.equal((await call('clips/test/abc/video.mp4')).status,400);
 assert.equal((await call('clips/test/1/video.mp4',{headers:{Origin:'https://evil.example'}})).status,403);
 const path='radio/root/all/0?adult=0&minimum=0';
 const first=await call(path);assert.equal(first.status,200);
 const etag=first.headers.get('etag');assert.ok(etag);assert.match(first.headers.get('cache-control'),/public/);
 assert.deepEqual((await first.json()).clips,[clip]);
 const repeated=await Promise.all(Array.from({length:12},()=>call(path)));
 assert.ok(repeated.every(r=>r.status===200 && r.headers.get('etag')===etag));
 const unchanged=await call(path,{headers:{'If-None-Match':etag}});
 assert.equal(unchanged.status,304);assert.equal(await unchanged.text(),'');
 assert.equal((await call(path,{headers:{'If-None-Match':'W/'+etag}})).status,304);
 assert.equal((await call(path,{headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await call('radio/root/all/99?adult=0&minimum=0')).status,400);
 assert.equal((await call(path+'&nonce=123')).status,400);
 assert.equal((await call('radio/board/missing/0')).status,404);
 const empty = await (await call('radio/thread/test.1/0?minimum=180')).json();
 assert.deepEqual(empty.clips,[]); assert.equal(empty.pending,false);
 const unread = await (await call('radio/thread/test.2/0')).json();
 assert.deepEqual(unread.clips,[]); assert.equal(unread.pending,true);
 const tree=await (await call('tree?minimum=60')).json();assert.equal(tree.boards[0].videoCount,1);
 assert.equal((await (await call('tree?minimum=180')).json()).boards[0].videoCount,0);
 console.log('PASS: public mode, private endpoints disabled, shared replies, ETag/304, canonical URLs, filtered counts');
} catch(e) { console.error(e);process.exitCode=1; }
finally {
 child.kill('SIGTERM');
 await new Promise(resolve => { if(child.exitCode !== null) resolve(); else child.once('exit',resolve); });
 assert.deepEqual(JSON.parse(await readFile(join(isolatedData,'library.json'),'utf8')),fixture,'fast shutdown must preserve the loaded index');
}
