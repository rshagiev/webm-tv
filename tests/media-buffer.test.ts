import { test } from "node:test";
import assert from "node:assert/strict";
import { canWarmNeighbor } from "../src/media-buffer";

const media = (ranges: number[][], overrides = {}) => ({
  paused: false,
  readyState: 3,
  currentTime: 10,
  duration: 60,
  buffered: {
    length: ranges.length,
    start: (i: number) => ranges[i][0],
    end: (i: number) => ranges[i][1],
  },
  ...overrides,
});
test("preload protects playback and accepts a fully buffered short clip", () => {
  assert.equal(canWarmNeighbor(media([[0, 12]]), true, true), false);
  assert.equal(canWarmNeighbor(media([[0, 14]]), true, true), true);
  assert.equal(
    canWarmNeighbor(
      media([[0, 2]], { currentTime: 0, duration: 2 }),
      true,
      true,
    ),
    true,
  );
  assert.equal(
    canWarmNeighbor(
      media([
        [0, 8],
        [20, 30],
      ]),
      true,
      true,
    ),
    false,
  );
  assert.equal(
    canWarmNeighbor(media([[0, 60]], { paused: true }), true, true),
    false,
  );
  assert.equal(
    canWarmNeighbor(media([[0, 60]], { readyState: 2 }), true, true),
    false,
  );
  assert.equal(canWarmNeighbor(media([[0, 60]]), false, true), false);
  assert.equal(canWarmNeighbor(media([[0, 60]]), true, false), false);
});
