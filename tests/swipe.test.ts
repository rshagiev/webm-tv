import {test} from 'node:test';
import assert from 'node:assert/strict';
import {swipeRelease} from '../src/swipe';
test('page gestures accept deliberate slow drags and fast flicks, reject taps and sideways motion',()=>{
 assert.equal(swipeRelease(0,-250,2000,844),'next');
 assert.equal(swipeRelease(0,240,1000,844),'previous');
 assert.equal(swipeRelease(0,-60,100,844),'next');
 assert.equal(swipeRelease(0,-60,600,844),null);
 assert.equal(swipeRelease(0,8,20,844),null);
 assert.equal(swipeRelease(300,-220,200,844),null);
});
