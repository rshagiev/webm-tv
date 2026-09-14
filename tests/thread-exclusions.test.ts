import test from "node:test";
import assert from "node:assert/strict";
import { threadAllowed, filterHistory } from "../src/thread-exclusions.js";
import { playbackHistory } from "../src/playback-history.js";
import type { Clip } from "../shared/model.js";
const clip = (id: string, thread: string, board = "b"): Clip => ({
  id,
  thread,
  board,
  title: id,
  post: id,
  url: `https://2ch.hk/${board}/src/${thread}/${id}.mp4`,
  duration: 60,
  width: 640,
  height: 360,
});
const blocked = [{ board: "b", thread: "10", title: "Thread" }];
test("exclude all attachments of one thread without affecting other boards or threads", () => {
  assert.equal(threadAllowed(clip("1", "10"), blocked), false);
  assert.equal(threadAllowed(clip("2", "10"), blocked), false);
  assert.equal(threadAllowed(clip("3", "11"), blocked), true);
  assert.equal(threadAllowed(clip("4", "10", "mu"), blocked), true);
  assert.equal(threadAllowed(clip("1", "10"), []), true);
});
test("filtering history preserves the selected clip and removes blocked back/forward entries", () => {
  const state = {
    history: [
      clip("1", "10"),
      clip("2", "11"),
      clip("3", "10"),
      clip("4", "12"),
    ],
    position: 1,
  };
  const result = playbackHistory(state, {
    type: "filter",
    allowed: (c) => threadAllowed(c, blocked),
  });
  assert.deepEqual(result, {
    history: [state.history[1], state.history[3]],
    position: 0,
  });
  assert.equal(
    playbackHistory(result, { type: "move", position: 1 }).history[1].thread,
    "12",
  );
});
test("excluding the playing clip clears the selection atomically, including reload snapshots", () => {
  const state = { history: [clip("1", "11"), clip("2", "10")], position: 1 };
  assert.deepEqual(
    filterHistory(state, (c) => threadAllowed(c, blocked)),
    { history: [], position: -1 },
  );
});
