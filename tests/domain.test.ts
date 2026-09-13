import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSources,
  type Board,
  type Source,
  type Clip,
} from "../shared/model.js";
import { parseBoards, mediaUrl, extract, plain } from "../server/source.js";
import { chooseClip } from "../src/queue.js";
const boards: Board[] = [
  {
    id: "mu",
    category: "Тематика",
    name: "Музыка",
    adult: false,
    threads: 2,
    video: true,
  },
  {
    id: "sex",
    category: "Взрослым",
    name: "Секс",
    adult: true,
    threads: 1,
    video: true,
  },
];
const topic: Source = {
  kind: "thread",
  board: "mu",
  id: "123",
  label: "Музыка",
};
test("selection union removes descendants only when ancestor belongs to the same branch", () => {
  const category: Source = {
    kind: "category",
    id: "Тематика",
    label: "Тематика",
  };
  const other: Source = {
    kind: "thread",
    board: "sex",
    id: "123",
    label: "Другой тред",
  };
  assert.deepEqual(normalizeSources([topic, category, other, topic], boards), [
    category,
    other,
  ]);
  assert.deepEqual(
    normalizeSources(
      [topic, { kind: "root", id: "all", label: "Всё" }],
      boards,
    ),
    [{ kind: "root", id: "all", label: "Всё" }],
  );
});
test("real board categories preserved including user boards, missing category and explicit adult flag", () => {
  const out = parseBoards({
    boards: [
      {
        id: "x",
        name: "A &amp; B",
        category: "Пользовательские",
        file_types: ["mp4"],
      },
      { id: "e", name: "E", category: "Взрослым", file_types: ["webm"] },
      { id: "z", name: "Z", category: "", file_types: [] },
    ],
  });
  assert.equal(out[0].category, "Пользовательские");
  assert.equal(out[0].name, "A & B");
  assert.equal(out[1].adult, true);
  assert.equal(out[2].category, "Без категории");
  assert.equal(out[2].video, false);
});
test("extracts reply attachments with null files and rejects foreign or unsafe media", () => {
  const clips = extract(
    [
      { num: 1, files: null },
      {
        num: 2,
        files: [
          { path: "/mu/src/123/a.mp4", md5: "same", duration_secs: 31 },
          { path: "https://evil.test/mu/src/a.mp4" },
          { path: "/mu/src/123/a.jpg" },
          { path: "http://2ch.hk/mu/src/a.mp4" },
        ],
      },
    ],
    "mu",
    "1",
    "T",
  );
  assert.equal(clips.length, 1);
  assert.equal(clips[0].post, "2");
  assert.equal(clips[0].duration, 31);
  assert.equal(clips[0].id, "md5:same");
  assert.equal(mediaUrl("https://2ch.hk.evil.test/mu/src/a.mp4"), undefined);
  assert.equal(
    mediaUrl("https://2ch.hk/mu/src/../../../private.mp4"),
    undefined,
  );
  assert.equal(plain("<b>Title</b> &amp; text"), "Title & text");
});
test("queue never returns hidden or seen clips, and terminates when exhausted", () => {
  const a = { id: "a" } as Clip,
    b = { id: "b" } as Clip,
    c = { id: "c" } as Clip;
  assert.equal(chooseClip([a, b, c], new Set(["a"]), new Set(["b"]))?.id, "c");
  assert.equal(chooseClip([a, b], new Set(["a"]), new Set(["b"])), undefined);
});

test("bodyless feed cancellation must not advertise JSON (Fastify rejects empty JSON bodies)", async () => {
  const { api } = await import("../src/api.js");
  const original = globalThis.fetch;
  let headers: Headers | undefined;
  globalThis.fetch = async (_url, init) => {
    headers = new Headers(init?.headers);
    return new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await api("/feeds/test", { method: "DELETE" });
    assert.equal(headers?.has("Content-Type"), false);
    await api("/feeds", {
      method: "POST",
      body: JSON.stringify({ sources: [] }),
    });
    assert.equal(headers?.get("Content-Type"), "application/json");
  } finally {
    globalThis.fetch = original;
  }
});
