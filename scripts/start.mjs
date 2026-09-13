import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
 console.error('WebM TV needs Node.js 22.12 or newer. Install the LTS version: https://nodejs.org/');
 process.exit(1);
}
let child;
let stopping=false;
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{stopping=true;child?.kill(signal);});
function run(command,args,env=process.env) {
 return new Promise((resolve,reject)=>{
  child=spawn(command,args,{cwd:root,stdio:'inherit',env,shell:process.platform==='win32' && command==='npm.cmd'});
  child.once('error',reject);
  child.once('exit',(code,signal)=>{if(stopping) resolve(false);else if(code===0) resolve(true);else reject(new Error(`Command failed (${signal || code}): ${command} ${args.join(' ')}`));});
 });
}
function npm(args) {
 return process.env.npm_execpath
  ? run(process.execPath,[process.env.npm_execpath,...args])
  : run(process.platform==='win32'?'npm.cmd':'npm',args);
}
const lockHash=createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');
let installedHash='';try {installedHash=readFileSync('node_modules/.webmtv-lock','utf8');} catch {}
try {
 if(installedHash!==lockHash || !existsSync('node_modules/tsx/package.json') || !existsSync('node_modules/vite/package.json')) {
  console.log('\nWebM TV · Installing dependencies (first launch)…\n');
  if(!await npm(['ci','--include=dev'])) process.exit(0);
  writeFileSync('node_modules/.webmtv-lock',lockHash);
 }
 console.log('\nWebM TV · Building the interface…\n');
 if(!await npm(['run','build'])) process.exit(0);
 await run(process.execPath,['--import','tsx','server/index.ts'],{...process.env,NODE_ENV:'production'});
} catch(error) {console.error('\n'+error.message);process.exitCode=1;}
