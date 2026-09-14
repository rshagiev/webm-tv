import test from "node:test";
import assert from "node:assert/strict";
import { resetSettings } from "../src/storage";

test("settings reset removes hidden sources and preferences but preserves bookmarks and unrelated data", () => {
  const data = new Map([
    ["webmtv:hidden", '["clip"]'],
    ["webmtv:excludedThreads", '[{"board":"b","thread":"123"}]'],
    ["webmtv:collections", '[{"name":"test"}]'],
    ["webmtv:interests-v1", '{"b:123":{}}'],
    ["webmtv:seen", '["clip"]'],
    ["webmtv:volume", "0.1"],
    ["webmtv:future-setting", "true"],
    ["webmtv:saved", '["bookmark"]'],
    ["other-app", "keep"],
  ]);
  const storage = {
    get length() { return data.size; },
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (key: string) => { data.delete(key); },
  } as Storage;
  resetSettings(storage);
  assert.deepEqual([...data], [
    ["webmtv:saved", '["bookmark"]'],
    ["other-app", "keep"],
  ]);
  resetSettings(storage);
  assert.equal(data.size, 2);
});
