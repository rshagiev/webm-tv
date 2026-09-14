import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerSharePages } from "../server/share-page.js";
import type { Clip } from "../shared/model.js";

test("share HTML and preview identify the exact indexed clip without executing JS", async () => {
  const clip = {
    board: "zog",
    thread: "123",
    url: "https://2ch.hk/zog/src/123/456.mp4",
    title: 'A "quote" <script>bad()</script> & title',
  } as Clip;
  const app = Fastify();
  registerSharePages(app, {
    find: async (a) =>
      a.board === "zog" && a.thread === "123" && a.file === "456.mp4"
        ? clip
        : undefined,
    html: () =>
      '<html><head><title>WebM TV</title></head><body><div id="root"></div></body></html>',
    publicOrigin: "https://tv.example",
  });
  const oldFetch = globalThis.fetch;
  let calls = 0;
  let mode = "jpeg";
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), "https://2ch.hk/zog/thumb/123/456s.jpg");
    assert.equal(init?.redirect, "manual");
    return new Response(
      mode === "oversize"
        ? new Uint8Array(2 * 1024 * 1024 + 1)
        : new Uint8Array([255, 216, 255, 217]),
      {
        headers: {
          "content-type": mode === "html" ? "text/html" : "image/jpeg",
          "set-cookie": "private=secret",
        },
      },
    );
  };
  try {
    const page = await app.inject("/watch/zog/123/456.mp4");
    assert.equal(page.statusCode, 200);
    assert.match(
      page.body,
      /property="og:image" content="https:\/\/tv.example\/api\/preview\/zog\/123\/456.mp4"/,
    );
    assert.match(
      page.body,
      /property="og:url" content="https:\/\/tv.example\/watch\/zog\/123\/456.mp4"/,
    );
    assert.match(page.body, /&quot;quote&quot; &lt;script&gt;/);
    assert.doesNotMatch(page.body, /<script>bad/);
    assert.match(page.body, /id="root"/);
    assert.equal((await app.inject("/watch/zog/123/999.mp4")).statusCode, 404);
    assert.equal(
      (await app.inject("/api/preview/zog/123/999.mp4")).statusCode,
      404,
    );
    assert.equal(
      (await app.inject("/api/preview/zog/123/secret.html")).statusCode,
      400,
    );
    assert.equal(calls, 0);
    const preview = await app.inject("/api/preview/zog/123/456.mp4");
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.headers["content-type"], "image/jpeg");
    assert.equal(preview.headers["set-cookie"], undefined);
    mode = "html";
    assert.equal(
      (await app.inject("/api/preview/zog/123/456.mp4")).statusCode,
      502,
    );
    mode = "oversize";
    assert.equal(
      (await app.inject("/api/preview/zog/123/456.mp4")).statusCode,
      502,
    );
  } finally {
    globalThis.fetch = oldFetch;
    await app.close();
  }
});
