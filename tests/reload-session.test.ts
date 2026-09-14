import test from "node:test";
import assert from "node:assert/strict";
import { decodeReload, RELOAD_TTL } from "../src/reload-session.js";
const clip = {
  id: "1",
  board: "b",
  thread: "1",
  post: "1",
  title: "Test",
  url: "https://2ch.hk/b/src/1/123.mp4",
  duration: 100,
  width: 640,
  height: 360,
};
const snapshot = {
  at: 1000,
  path: "/",
  history: [clip, { ...clip, id: "2", url: "https://2ch.hk/b/src/1/124.mp4" }],
  position: 0,
  selection: { kind: "board", id: "b", label: "Бред" },
  sources: [{ kind: "board", id: "b", label: "Бред" }],
  time: 42.5,
  playing: false,
};
test("quick reload preserves current history cursor, time, source and paused state", () => {
  assert.deepEqual(decodeReload(JSON.stringify(snapshot), "/", 1100), snapshot);
});
test("old snapshots and other links do not restore playback", () => {
  assert.equal(
    decodeReload(JSON.stringify(snapshot), "/", 1001 + RELOAD_TTL),
    undefined,
  );
  assert.equal(
    decodeReload(JSON.stringify(snapshot), "/watch/b/1/124.mp4", 1100),
    undefined,
  );
  assert.equal(decodeReload(JSON.stringify(snapshot), "/", 999), undefined);
});
test("invalid snapshots cannot restore an inconsistent cursor or arbitrary video URL", () => {
  for (const patch of [
    { position: 2 },
    { time: -1 },
    { history: [{ ...clip, url: "https://example.com/video.mp4" }] },
    { sources: [] },
    { history: [] },
    { playing: "yes" },
  ])
    assert.equal(
      decodeReload(JSON.stringify({ ...snapshot, ...patch }), "/", 1100),
      undefined,
    );
  assert.equal(decodeReload("{", "/", 1100), undefined);
});
