import { test } from "node:test";
import assert from "node:assert/strict";
import { learn, reward, interestWeight, watchDelta } from "../src/preferences";
import { permitted } from "../server/access";
import type { Clip } from "../shared/model";
const clip = { id: "a", board: "ne", thread: "1", title: "Animals" } as Clip;
test("watch measurement ignores seeks, hidden tabs, waiting and suspended timers", () => {
  assert.equal(watchDelta(0.25, 0.25, true), 0.25);
  assert.equal(watchDelta(30, 0.25, true), 0);
  assert.equal(watchDelta(0.25, 0.25, false), 0);
  assert.equal(watchDelta(0, 1, true), 0);
  assert.equal(watchDelta(10, 10, true), 0);
});
test("errors and leaving sources are neutral; completion uses duration, fast skip is weak", () => {
  const o = { clip, watched: 2, duration: 60, reason: "skip" as const };
  assert.equal(reward(o), -0.4);
  assert.equal(reward({ ...o, reason: "error" }), null);
  assert.equal(reward({ ...o, reason: "leave" }), null);
  assert.equal(
    reward({ ...o, watched: 9, duration: 10, reason: "ended" }),
    0.8,
  );
  assert.equal(reward({ ...o, watched: 9, duration: 100 }), 0);
});
test("interest grows gradually, stays bounded and decays; board transfer is weaker", () => {
  let p = {};
  const now = 100000;
  for (let i = 0; i < 10; i++)
    p = learn(p, { clip, watched: 9, duration: 10, reason: "ended" }, now);
  const w = interestWeight(p, clip, now);
  assert.ok(w > 1 && w < 13);
  assert.ok(interestWeight(p, { ...clip, thread: "2" }, now) < w);
  assert.equal(interestWeight(p, { ...clip, board: "mu" }, now), 1);
  assert.ok(interestWeight(p, clip, now + 60 * 86400000) < w);
});
test("LAN guard accepts local interfaces but rejects foreign hosts and origins", () => {
  assert.equal(permitted("127.0.0.1:4173", "http://127.0.0.1:4173"), true);
  assert.equal(permitted("localhost:4173", "http://localhost:5173"), true);
  assert.equal(permitted("evil.example:4173"), false);
  assert.equal(permitted("localhost:4173", "http://evil.example:4173"), false);
  assert.equal(permitted("localhost:4173", "null"), false);
});
