import { test } from "node:test";
import assert from "node:assert/strict";
import { VideoLibrary } from "../server/library-state.js";
import { chooseClip, swipeDirection } from "../src/queue.js";
import type { Board, Clip, Topic } from "../shared/model.js";
const board: Board = {
  id: "test",
  name: "Test",
  category: "Тематика",
  adult: false,
  threads: 2,
  video: true,
};
const topic: Topic = {
  id: "1",
  board: "test",
  title: "Only replies",
  posts: 5,
  files: 3,
  opVideos: 0,
  updated: 1,
};
const clip: Clip = {
  id: "a",
  board: "test",
  thread: "1",
  post: "2",
  url: "https://2ch.hk/test/src/1/a.mp4",
  title: "Only replies",
  duration: 20,
  width: 720,
  height: 1280,
};
test("no OP video means unknown, never empty; full reply scan determines availability", () => {
  const lib = new VideoLibrary();
  lib.catalog("test", [topic], [], 1);
  assert.equal(lib.topics("test")[0].videoState, "unknown");
  assert.equal(lib.board(board).videoState, "unknown");
  lib.thread("test", "1", [clip], 2);
  assert.equal(lib.topics("test")[0].videoState, "ready");
  assert.equal(lib.board(board).videoCount, 1);
  lib.thread("test", "1", [], 3);
  assert.equal(lib.topics("test")[0].videoState, "empty");
  assert.equal(lib.board(board).videoState, "empty");
  lib.catalog("test", [{ ...topic, posts: 6, updated: 2 }], [], 4);
  assert.equal(lib.topics("test")[0].videoState, "unknown");
});
test("failed scan is not a claim of emptiness, and removed threads disappear from the index", () => {
  const lib = new VideoLibrary();
  lib.catalog("test", [topic], [], 1);
  lib.failure("test", "1", "timeout");
  assert.equal(lib.topics("test")[0].videoState, "error");
  lib.thread("test", "1", [clip], 2);
  lib.catalog("test", [], [], 3);
  assert.equal(lib.board(board).videoCount, 0);
  assert.deepEqual(
    lib.clips([{ kind: "root", id: "all", label: "All" }], [board], true),
    [],
  );
});
test("a verified empty full thread must not resurrect from a stale catalog OP attachment", () => {
  const lib = new VideoLibrary();
  const op = { ...topic, opVideos: 1 };
  lib.catalog("test", [op], [clip], 1);
  lib.thread("test", "1", [], 2);
  lib.catalog("test", [op], [clip], 3);
  assert.equal(lib.topics("test")[0].videoState, "empty");
});
test("wide shuffle switches threads even when one thread dominates the pool", () => {
  const pool = [
    ...Array.from({ length: 100 }, (_, i) => ({ ...clip, id: String(i) })),
    { ...clip, id: "other", thread: "2" },
  ];
  for (let i = 0; i < 30; i++)
    assert.equal(chooseClip(pool, new Set(), new Set(), clip)?.thread, "2");
  assert.ok(chooseClip(pool.slice(0, 100), new Set(), new Set(), clip));
});
test("only intentional vertical swipes navigate, taps and horizontal scrubs do not", () => {
  assert.equal(swipeDirection(8, -140, 250), "next");
  assert.equal(swipeDirection(10, 110, 300), "previous");
  assert.equal(swipeDirection(0, 15, 100), null);
  assert.equal(swipeDirection(100, -70, 200), null);
  assert.equal(swipeDirection(0, 100, 1500), null);
});

test("duration-filtered tree counts all reply clips, returns matching samples and leaves the index intact", () => {
  const lib = new VideoLibrary();
  lib.catalog("test", [topic, { ...topic, id: "2" }], [], 1);
  lib.thread(
    "test",
    "1",
    [
      { ...clip, id: "short", duration: 59 },
      { ...clip, id: "boundary", duration: 60 },
      { ...clip, id: "long", duration: 600 },
      { ...clip, id: "longer", duration: 900 },
      { ...clip, id: "unknown", duration: 0 },
    ],
    2,
  );
  lib.thread(
    "test",
    "2",
    [{ ...clip, id: "reply", thread: "2", duration: 30 }],
    2,
  );
  assert.equal(lib.board(board).videoCount, 6);
  assert.equal(lib.board(board, 60).videoCount, 3);
  assert.equal(lib.board(board, 600).videoCount, 2);
  assert.deepEqual(
    lib.topics("test", 600).map((t) => t.videoCount),
    [2, 0],
  );
  assert.ok(lib.board(board, 600).samples!.every((c) => c.duration >= 600));
  assert.equal(lib.topics("test", 600)[1].videoState, "empty");
  assert.equal(lib.board(board).videoCount, 6);
  assert.equal(lib.data.test.topics["1"].clips.length, 5);
});
