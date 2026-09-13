import { test } from "node:test";
import assert from "node:assert/strict";
import { clipPath, sharedClipApi, validClipAddress } from "../shared/share";
import type { Clip } from "../shared/model";
test("share links identify an exact attachment on our service without the source URL", () => {
  const clip = {
    board: "sp",
    thread: "123",
    url: "https://2ch.hk/sp/src/123/456.mp4",
  } as Clip;
  assert.equal(clipPath(clip), "/watch/sp/123/456.mp4");
  assert.equal(sharedClipApi(clipPath(clip)), "/clips/sp/123/456.mp4");
  assert.equal(
    clipPath({ ...clip, url: "https://2ch.hk/sp/src/123/457.mp4" }),
    "/watch/sp/123/457.mp4",
  );
  for (const path of [
    "/watch/sp/123/../secret",
    "/watch/sp/123/evil.html",
    "/watch/sp/123/456.mp4/extra",
    "/watch/sp/123/%2Fetc.mp4",
  ])
    assert.equal(sharedClipApi(path), null);
  assert.equal(validClipAddress("sp", "abc", "456.mp4"), false);
});
