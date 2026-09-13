import test from "node:test";
import assert from "node:assert/strict";
import { sampleRadio, validSources, PublicCache } from "../server/public.js";
import { VideoLibrary } from "../server/library-state.js";
import type { Board, Clip, Source } from "../shared/model.js";
const root: Source[] = [{ kind: "root", id: "all", label: "All" }];
const registry: Board[] = [
  {
    id: "a",
    name: "A",
    category: "cat",
    adult: false,
    threads: 2,
    video: true,
  },
  {
    id: "x",
    name: "X",
    category: "adult",
    adult: true,
    threads: 1,
    video: true,
  },
];
const clip = (id: string, board = "a", thread = "1", duration = 120): Clip => ({
  id,
  board,
  thread,
  duration,
  post: id,
  title: id,
  url: "https://2ch.hk/test.mp4",
  width: 1,
  height: 1,
});
test("public sampling caps output and preserves adult, source, duration, and seen boundaries", () => {
  const lib = new VideoLibrary();
  lib.thread(
    "a",
    "1",
    Array.from({ length: 200 }, (_, i) => clip(String(i))),
  );
  lib.thread("a", "2", [
    clip("short", "a", "2", 10),
    clip("long", "a", "2", 600),
  ]);
  lib.thread("x", "3", [clip("adult", "x", "3", 600)]);
  const sample = sampleRadio(
    lib,
    registry,
    root,
    false,
    60,
    new Set(["1", "2"]),
  );
  assert.equal(sample.length, 96);
  assert.equal(new Set(sample.map((c) => c.id)).size, 96);
  assert.ok(
    sample.every(
      (c) => c.board === "a" && c.duration >= 60 && !["1", "2"].includes(c.id),
    ),
  );
  assert.ok(sample.some((c) => c.id === "long"));
  assert.deepEqual(
    sampleRadio(
      lib,
      registry,
      [{ kind: "thread", id: "2", board: "a", label: "thread" }],
      false,
      60,
      new Set(),
    ).map((c) => c.id),
    ["long"],
  );
  assert.equal(
    sampleRadio(
      lib,
      registry,
      [{ kind: "board", id: "x", label: "x" }],
      false,
      0,
      new Set(),
    ).length,
    0,
  );
  assert.equal(
    sampleRadio(
      lib,
      registry,
      [{ kind: "board", id: "x", label: "x" }],
      true,
      0,
      new Set(),
    )[0].id,
    "adult",
  );
});
test("public request validation and shared cache are bounded", () => {
  assert.ok(validSources(root));
  assert.ok(!validSources(Array(33).fill(root[0])));
  assert.ok(
    !validSources([{ kind: "thread", id: "../x", board: "a", label: "x" }]),
  );
  const cache = new PublicCache();
  let calls = 0;
  assert.equal(
    cache.get("a", () => ++calls, 0),
    1,
  );
  assert.equal(
    cache.get("a", () => ++calls, 1),
    1,
  );
  assert.equal(
    cache.get("a", () => ++calls, 30001),
    2,
  );
  for (let i = 0; i < 33; i++) cache.get(String(i), () => i, 30002);
  assert.equal(
    cache.get("a", () => ++calls, 30003),
    3,
  );
});
