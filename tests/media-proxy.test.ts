import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerMedia } from "../server/media.js";
import { playbackUrl } from "../shared/media.js";

test("media streams range bytes with server credentials and rejects unsafe redirects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "webmtv-media-"));
  const oldFile = process.env.SOURCE_USERCODE_FILE;
  process.env.SOURCE_USERCODE_FILE = join(dir, "session");
  await writeFile(process.env.SOURCE_USERCODE_FILE, "test-private-session");
  const oldFetch = globalThis.fetch;
  const app = Fastify();
  registerMedia(app);
  let calls = 0;
  let mode = "video";
  globalThis.fetch = async (_url, init) => {
    calls++;
    const headers = new Headers(init?.headers);
    if (!headers.get("Cookie")) {
      assert.equal(init?.method, "HEAD");
      return new Response(null, { status: 500 });
    }
    assert.equal(headers.get("Cookie"), "usercode_auth=test-private-session");
    assert.equal(init?.redirect, "manual");
    if (mode === "redirect")
      return new Response(null, {
        status: 302,
        headers: { Location: "https://attacker.example/hc/src/123/456.mp4" },
      });
    if (mode === "html")
      return new Response("blocked", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    if (mode === "416")
      return new Response(null, {
        status: 416,
        headers: { "content-range": "bytes */100" },
      });
    assert.equal(headers.get("Range"), "bytes=0-3");
    return new Response(
      init?.method === "HEAD" ? null : new Uint8Array([1, 2, 3, 4]),
      {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-length": "4",
          "content-range": "bytes 0-3/100",
          "set-cookie": "secret=upstream",
        },
      },
    );
  };
  try {
    const url = "/api/media/hc/src/123/456.mp4";
    assert.equal(playbackUrl("https://2ch.hk/hc/src/123/456.mp4"), url);
    const result = await app.inject({
      url,
      headers: { range: "bytes=0-3", cookie: "client-secret=do-not-forward" },
    });
    assert.equal(result.statusCode, 206);
    assert.deepEqual([...result.rawPayload], [1, 2, 3, 4]);
    assert.equal(result.headers["content-range"], "bytes 0-3/100");
    assert.equal(result.headers["set-cookie"], undefined);
    assert.equal(result.headers["cache-control"], "private, no-store");
    const head = await app.inject({
      method: "HEAD",
      url,
      headers: { range: "bytes=0-3" },
    });
    assert.equal(head.statusCode, 206);
    assert.equal(head.body, "");
    const before = calls;
    assert.equal(
      (await app.inject({ url, headers: { range: "bytes=0-1,5-6" } }))
        .statusCode,
      416,
    );
    assert.equal(
      (await app.inject({ url: "/api/media/hc/catalog.json" })).statusCode,
      400,
    );
    assert.equal(calls, before);
    mode = "redirect";
    assert.equal((await app.inject({ url })).statusCode, 502);
    assert.equal(calls, before + 1);
    mode = "html";
    assert.equal((await app.inject({ url })).statusCode, 502);
    mode = "416";
    const unsatisfied = await app.inject({ url });
    assert.equal(unsatisfied.statusCode, 416);
    assert.equal(unsatisfied.headers["content-range"], "bytes */100");
  } finally {
    await app.close();
    globalThis.fetch = oldFetch;
    if (oldFile === undefined) delete process.env.SOURCE_USERCODE_FILE;
    else process.env.SOURCE_USERCODE_FILE = oldFile;
    await rm(dir, { recursive: true, force: true });
  }
});

test("open media redirects without credentials; six active streams per IP leave capacity for others", async () => {
  const dir = await mkdtemp(join(tmpdir(), "webmtv-limits-"));
  const previous = process.env.SOURCE_USERCODE_FILE;
  process.env.SOURCE_USERCODE_FILE = join(dir, "cookie");
  await writeFile(process.env.SOURCE_USERCODE_FILE, "test-session");
  const oldFetch = globalThis.fetch;
  const app = Fastify();
  registerMedia(app);
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  let ready!: () => void;
  const six = new Promise<void>((resolve) => {
    ready = resolve;
  });
  globalThis.fetch = async (url, init) => {
    const cookie = new Headers(init?.headers).get("Cookie");
    if (String(url).includes("/open.mp4")) {
      assert.equal(cookie, null);
      return new Response(null, { headers: { "content-type": "video/mp4" } });
    }
    if (!cookie) return new Response(null, { status: 500 });
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streams.push(controller);
          if (streams.length === 6) ready();
        },
      }),
      { headers: { "content-type": "video/mp4" } },
    );
  };
  try {
    assert.equal(
      (await app.inject({ url: "/api/media/b/src/1/open.mp4" })).statusCode,
      302,
    );
    const first = Array.from({ length: 6 }, (_, i) =>
      app.inject({
        url: `/api/media/hc/src/1/${i}.mp4`,
        remoteAddress: "127.0.0.2",
      }),
    );
    await six;
    assert.equal(
      (
        await app.inject({
          url: "/api/media/hc/src/1/7.mp4",
          remoteAddress: "127.0.0.2",
        })
      ).statusCode,
      429,
    );
    const other = app.inject({
      url: "/api/media/hc/src/1/8.mp4",
      remoteAddress: "127.0.0.3",
    });
    // Close the first user's streams, then the independently accepted other stream.
    for (const controller of streams.slice(0, 6)) controller.close();
    await Promise.all(first);
    while (streams.length < 7)
      await new Promise((resolve) => setImmediate(resolve));
    streams[6].close();
    assert.equal((await other).statusCode, 200);
  } finally {
    await app.close();
    globalThis.fetch = oldFetch;
    if (previous === undefined) delete process.env.SOURCE_USERCODE_FILE;
    else process.env.SOURCE_USERCODE_FILE = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
