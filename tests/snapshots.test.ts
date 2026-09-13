import test from "node:test";
import assert from "node:assert/strict";
import { Snapshots } from "../server/snapshots.js";
import { RefillCursor, mergeRadioPool } from "../src/radio-pool.js";
import { radioPath } from "../shared/radio.js";
import type { Clip, Source } from "../shared/model.js";

test("shared snapshots serialize once, preserve ETag, and rebuild only after expiry", () => {
  const cache = new Snapshots();
  let calls = 0;
  const first = cache.get("same", () => ({ count: ++calls }), 0);
  for (let i = 0; i < 1000; i++)
    assert.equal(
      cache.get("same", () => ({ count: ++calls }), i),
      first,
    );
  assert.equal(calls, 1);
  assert.equal(cache.hits, 1000);
  const same = cache.get("same", () => ({ count: 1 }), 60001);
  assert.equal(first.etag, same.etag);
  const changed = cache.get("same", () => ({ count: 2 }), 120002);
  assert.notEqual(first.etag, changed.etag);
});
test("cache bounds UTF-8 bytes and entries, and oversized responses do not evict the hot set", () => {
  const cache = new Snapshots(40, 2);
  cache.get("a", () => ({ a: "Я" }), 0);
  cache.get("b", () => ({ b: "Б" }), 0);
  cache.get("a", () => null, 1);
  cache.get("c", () => ({ c: "В" }), 2);
  assert.equal(cache.size, 2);
  assert.ok(cache.byteSize <= 40);
  const builds = cache.builds;
  cache.get("a", () => null, 3);
  assert.equal(cache.builds, builds);
  cache.get("large", () => ({ text: "x".repeat(100) }), 4);
  assert.equal(cache.size, 2);
  assert.ok(cache.byteSize <= 40);
});
test("shared URLs omit user history and refill cursors stop after small channels or eight batches", () => {
  const source: Source = { kind: "thread", board: "a", id: "12", label: "A" };
  assert.equal(
    radioPath(source, 3, false, 60),
    "/radio/thread/a.12/3?adult=0&minimum=60",
  );
  const cursor = new RefillCursor(() => 0);
  for (let i = 0; i < 8; i++) cursor.accept(false, 100);
  assert.equal(cursor.bucket, 0);
  assert.equal(cursor.readyAt, 60100);
  const small = new RefillCursor(() => 0);
  small.accept(true, 100);
  assert.equal(small.readyAt, 60100);
});
test("collection queue stays bounded and retains each source across asynchronous responses", () => {
  const sources: Source[] = [
    { kind: "board", id: "a", label: "A" },
    { kind: "board", id: "b", label: "B" },
  ];
  const clips = (board: string): Clip[] =>
    Array.from({ length: 400 }, (_, i) => ({
      id: board + i,
      board,
      thread: "1",
      post: String(i),
      title: "Test",
      url: "https://2ch.hk/test.mp4",
      duration: 60,
      width: 1,
      height: 1,
    }));
  const pool = mergeRadioPool(clips("a"), clips("b"), sources, []);
  assert.equal(pool.length, 400);
  assert.equal(pool.filter((c) => c.board === "a").length, 200);
  assert.equal(pool.filter((c) => c.board === "b").length, 200);
  assert.equal(
    mergeRadioPool(clips("a"), clips("b"), [sources[1]], []).some(
      (c) => c.board === "a",
    ),
    false,
  );
});

test("empty batches expire quickly so cold starts do not wait a full minute", () => {
  const cache = new Snapshots();
  let calls = 0;
  cache.get(
    "empty",
    () => ++calls,
    0,
    () => 5000,
  );
  cache.get(
    "empty",
    () => ++calls,
    4999,
    () => 5000,
  );
  assert.equal(calls, 1);
  cache.get(
    "empty",
    () => ++calls,
    5001,
    () => 5000,
  );
  assert.equal(calls, 2);
  const cursor = new RefillCursor(() => 0);
  cursor.accept(true, 0, 5000);
  assert.equal(cursor.readyAt, 5000);
});
