import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("source session stays upstream, rotates cached requests, and never exposes credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "webmtv-session-"));
  const previous = {
    data: process.env.WEBMTV_DATA_DIR,
    file: process.env.SOURCE_USERCODE_FILE,
    host: process.env.SOURCE_HOST,
  };
  process.env.WEBMTV_DATA_DIR = dir;
  process.env.SOURCE_HOST = "2ch.su";
  delete process.env.SOURCE_USERCODE_FILE;
  const originalFetch = globalThis.fetch;
  const calls: {
    url: string;
    cookie: string | null;
    redirect: string | undefined;
  }[] = [];
  let invalidJson = false;
  globalThis.fetch = async (input, options) => {
    calls.push({
      url: String(input),
      cookie: new Headers(options?.headers).get("cookie"),
      redirect: options?.redirect,
    });
    return new Response(
      invalidJson
        ? "<html>session-secret-b</html>"
        : JSON.stringify({ threads: [], request: calls.length }),
    );
  };
  try {
    const { json } = await import("../server/source.js");
    const { sourceSession } = await import("../server/source-session.js");
    const anonymous = await json("/hc/catalog.json");
    assert.equal(calls[0].cookie, null);
    const file = join(dir, "source-usercode.txt");
    await writeFile(file, "session-secret-a\n");
    const authenticated = await json("/hc/catalog.json");
    assert.notDeepEqual(authenticated, anonymous);
    assert.equal(calls[1].cookie, "usercode_auth=session-secret-a");
    assert.equal(calls[1].url, "https://2ch.su/hc/catalog.json");
    assert.equal(calls[1].redirect, "error");
    await json("/hc/catalog.json");
    assert.equal(calls.length, 2);
    await writeFile(file, "session-secret-b");
    await json("/hc/catalog.json");
    assert.equal(calls.length, 3);
    assert.equal(calls[2].cookie, "usercode_auth=session-secret-b");
    await assert.rejects(
      json("https://example.com/leak.json"),
      /Invalid source path/,
    );
    assert.equal(calls.length, 3);
    invalidJson = true;
    await assert.rejects(json("/hc/res/123.json"), {
      message: "Источник вернул некорректный JSON",
    });
    for (const name of await readdir(join(dir, "cache"))) {
      assert.ok(!name.includes("session-secret"));
      assert.ok(
        !(await readFile(join(dir, "cache", name), "utf8")).includes(
          "session-secret",
        ),
      );
    }
    for (const bad of [
      "",
      "usercode_auth=secret",
      "secret; other=value",
      "secret\r\nInjected: value",
    ]) {
      await writeFile(file, bad);
      await assert.rejects(sourceSession(), {
        message:
          "Файл сессии Двача должен содержать только значение usercode_auth",
      });
    }
    await rm(file);
    assert.equal((await sourceSession()).cacheScope, "anonymous");
    process.env.SOURCE_USERCODE_FILE = join(dir, "missing-secret-path");
    await assert.rejects(sourceSession(), {
      message: "Не удалось прочитать файл сессии Двача",
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({
      WEBMTV_DATA_DIR: previous.data,
      SOURCE_USERCODE_FILE: previous.file,
      SOURCE_HOST: previous.host,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
