import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchesDuration} from '../src/duration';
import type {Clip} from '../shared/model';
test('long-only includes boundary, rejects shorter and unknown duration, disabling restores all',()=>{
 const clip=(duration:number)=>({duration}) as Clip;
 assert.equal(matchesDuration(clip(60),true,60),true);
 assert.equal(matchesDuration(clip(59.9),true,60),false);
 assert.equal(matchesDuration(clip(180),true,300),false);
 assert.equal(matchesDuration(clip(0),true,60),false);
 assert.equal(matchesDuration(clip(NaN),true,60),false);
 assert.equal(matchesDuration(clip(0),false,60),true);
});
