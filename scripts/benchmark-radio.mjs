// Run on the VPS: node --import tsx scripts/benchmark-radio.mjs SNAPSHOT.json [iterations]
import {readFile} from 'node:fs/promises';
import {VideoLibrary} from '../server/library-state.ts';
import {sampleRadio} from '../server/public.ts';
import {Snapshots} from '../server/snapshots.ts';
import {boards} from '../server/source.ts';
const lib=new VideoLibrary();lib.data=JSON.parse(await readFile(process.argv[2],'utf8')).boards;
const registry=await boards();const sources=[{kind:'root',id:'all',label:'All'}];
const count=Number(process.argv[3]||1000);
const make=()=>({clips:sampleRadio(lib,registry,sources,false,0,new Set())});
function measure(fn){const start=performance.now(),cpu=process.cpuUsage();let bytes=0;for(let i=0;i<count;i++)bytes+=fn(i).length;const used=process.cpuUsage(cpu);return {ms:performance.now()-start,cpuMs:(used.user+used.system)/1000,bytes};}
const before=measure(()=>JSON.stringify(make()));
const cache=new Snapshots();const after=measure(i=>cache.get('root:'+(i%8),make,0).body);
console.log(JSON.stringify({iterations:count,clips:Object.values(lib.data).reduce((n,b)=>n+Object.values(b.topics).reduce((n,t)=>n+t.clips.length,0),0),before,after,builds:cache.builds,hits:cache.hits,cacheBytes:cache.byteSize},null,2));
