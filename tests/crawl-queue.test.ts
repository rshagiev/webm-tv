import { test } from "node:test";
import assert from "node:assert/strict";
import { CrawlQueue, needsRead, catalogInterval } from "../server/crawl-queue";
import { VideoLibrary } from "../server/library-state";
import type { Board, Topic } from "../shared/model";
const board = (id: string, activity = 0) =>
  ({
    id,
    activity,
    video: true,
    name: id,
    category: "Test",
    adult: false,
    threads: 100,
  }) as Board;
const topic = (id: string, opVideos = 0) =>
  ({
    id,
    board: "test",
    title: id,
    posts: 10,
    files: 9,
    updated: 1,
    opVideos,
  }) as Topic;
const now = 1_000_000;
test("catalog updates preserve last read and separate stale from never read", () => {
  const lib = new VideoLibrary();
  lib.catalog("test", [topic("1")], [], 1);
  lib.thread("test", "1", [], 10);
  lib.catalog("test", [{ ...topic("1"), posts: 11 }], [], 20);
  let e = lib.data.test.topics["1"];
  assert.equal(e.checkedAt, 10);
  assert.equal(e.stale, true);
  assert.equal(lib.topics("test")[0].videoState, "unknown");
  assert.equal(needsRead(e, 100), false);
  assert.equal(needsRead(e, 60_010), true);
  lib.thread("test", "1", [], 30);
  e = lib.data.test.topics["1"];
  assert.equal(e.stale, false);
  assert.equal(lib.topics("test")[0].videoState, "empty");
});
test("all reply-only topics get read even with OP-video topics present", () => {
  const lib = new VideoLibrary();
  lib.catalog(
    "test",
    Array.from({ length: 60 }, (_, i) => topic(String(i + 1), i < 5 ? 10 : 0)),
    [],
    1,
  );
  const q = new CrawlQueue(),
    ids = new Set();
  for (let i = 0; i < 60; i++) {
    const t = q.pick(lib.data, [board("test")], new Map(), now)!;
    ids.add(t.entry.topic.id);
    lib.thread(t.board, t.entry.topic.id, [], now);
  }
  assert.equal(ids.size, 60);
  assert.equal(q.pick(lib.data, [board("test")], new Map(), now), undefined);
});
test("discovery and stale refresh alternate within the same board", () => {
  const lib = new VideoLibrary();
  lib.catalog("test", [topic("1"), topic("2"), topic("3")], [], 1);
  lib.thread("test", "3", [], 2);
  lib.catalog(
    "test",
    [topic("1"), topic("2"), { ...topic("3"), posts: 20 }],
    [],
    3,
  );
  const q = new CrawlQueue();
  let t = q.pick(lib.data, [board("test")], new Map(), now)!;
  assert.equal(t.entry.checkedAt, 0);
  lib.thread("test", t.entry.topic.id, [], now);
  t = q.pick(lib.data, [board("test")], new Map(), now)!;
  assert.equal(t.entry.topic.id, "3");
});
test("active boards receive more capacity without starving quiet boards or newly added boards", () => {
  const lib = new VideoLibrary();
  for (const id of ["fast", "quiet"])
    lib.catalog(
      id,
      Array.from({ length: 100 }, (_, i) => ({
        ...topic(String(i + 1)),
        board: id,
      })),
      [],
      1,
    );
  const q = new CrawlQueue(),
    bs = [board("fast", 10000), board("quiet")],
    counts = { fast: 0, quiet: 0 };
  for (let i = 0; i < 60; i++) {
    const t = q.pick(lib.data, bs, new Map(), now)!;
    counts[t.board as keyof typeof counts]++;
    lib.thread(t.board, t.entry.topic.id, [], now);
  }
  assert.ok(counts.quiet >= 9);
  assert.ok(counts.fast > counts.quiet);
  lib.catalog("new", [{ ...topic("1"), board: "new" }], [], 1);
  bs.push(board("new"));
  const picked = [];
  for (let i = 0; i < 10; i++) {
    const t = q.pick(lib.data, bs, new Map(), now)!;
    picked.push(t.board);
    lib.thread(t.board, t.entry.topic.id, [], now);
  }
  assert.ok(picked.includes("new"));
  assert.equal(catalogInterval(bs[0]), 60_000);
  assert.equal(catalogInterval(bs[1]), 300_000);
});
test("exact selection wins over broad requests, is deduplicated, and respects cooldown", () => {
  const lib = new VideoLibrary();
  lib.catalog("test", [topic("1"), topic("2")], [], 1);
  const q = new CrawlQueue();
  q.request("test", undefined, now);
  for (let i = 0; i < 100; i++) q.request("test", "2", now);
  const t = q.pick(lib.data, [board("test")], new Map(), now)!;
  assert.equal(t.entry.topic.id, "2");
  lib.thread("test", "2", [], now);
  q.request("test", "2", now);
  assert.equal(
    q.pick(lib.data, [board("test")], new Map(), now)!.entry.topic.id,
    "1",
  );
  const retry = new Map([["test:1", now + 60_000]]);
  assert.equal(q.pick(lib.data, [board("test")], retry, now), undefined);
});
test("continuous priority requests leave background work a bounded share", () => {
  const lib = new VideoLibrary();
  for (const id of ["focus", "other"])
    lib.catalog(
      id,
      Array.from({ length: 40 }, (_, i) => ({
        ...topic(String(i + 1)),
        board: id,
      })),
      [],
      1,
    );
  const q = new CrawlQueue();
  let other = 0;
  for (let i = 0; i < 18; i++) {
    q.request("focus", undefined, now);
    const t = q.pick(
      lib.data,
      [board("focus"), board("other")],
      new Map(),
      now,
    )!;
    if (t.board === "other") other++;
    lib.thread(t.board, t.entry.topic.id, [], now);
  }
  assert.ok(other >= 3);
});
