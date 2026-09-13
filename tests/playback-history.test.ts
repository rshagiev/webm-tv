import { test } from "node:test";
import assert from "node:assert/strict";
import type { Clip } from "../shared/model";
import { playbackHistory, emptyHistory } from "../src/playback-history";
const clip = (id: string) => ({ id }) as Clip;
test("batched advances cannot leave the cursor past the selected video", () => {
  let s = emptyHistory;
  for (let i = 0; i < 450; i++) {
    s = playbackHistory(s, { type: "append", clip: clip(String(i)) });
    assert.equal(s.history[s.position].id, String(i));
    assert.ok(s.history.length <= 200);
  }
  s = playbackHistory(s, { type: "move", position: 3 });
  s = playbackHistory(s, { type: "append", clip: clip("branch") });
  assert.equal(s.history.length, 5);
  assert.equal(s.history[s.position].id, "branch");
  s = playbackHistory(s, { type: "reset" });
  s = playbackHistory(s, { type: "move", position: 99 });
  assert.deepEqual(s, emptyHistory);
  s = playbackHistory(s, { type: "reset", clip: clip("shared") });
  assert.equal(s.history[s.position].id, "shared");
});
test("two advances in one render retain both clips and select the final one", () => {
  const initial = playbackHistory(emptyHistory, {
    type: "reset",
    clip: clip("a"),
  });
  const result = [clip("b"), clip("c")].reduce(
    (s, c) => playbackHistory(s, { type: "append", clip: c }),
    initial,
  );
  assert.deepEqual(
    result.history.map((c) => c.id),
    ["a", "b", "c"],
  );
  assert.equal(result.position, 2);
  assert.equal(result.history[result.position].id, "c");
});
