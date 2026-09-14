import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { Audience, registerAudience } from "../server/audience.js";
const id = "12345678-1234-1234-1234-123456789abc";
const start = Date.parse("2026-09-14T12:00:00Z");

test("deduplicates browsers and overlapping tabs, expires online, excludes pauses", () => {
  const a = new Audience();
  a.heartbeat(id, 30, true, start);
  a.heartbeat(id, 15, true, start + 15_000);
  a.heartbeat(id, 15, true, start + 15_000);
  a.heartbeat(id, 0, false, start + 30_000);
  const s = a.summary(start + 30_000);
  assert.equal(s.online, 1);
  assert.equal(s.today.browsers, 1);
  assert.equal(s.today.watchSeconds, 15);
  assert.equal(a.summary(start + 75_000).online, 0);
  assert.ok(!JSON.stringify(a.data).includes(id));
});

test("separates days, bounds delayed time and prunes old identifiers", () => {
  const a = new Audience();
  a.heartbeat(id, 0, true, start);
  a.heartbeat(id, 30, true, start + 120_000);
  assert.equal(a.summary(start + 120_000).today.watchSeconds, 0);
  a.heartbeat(id, 30, true, start + 86400_000);
  assert.equal(a.summary(start + 86400_000).today.browsers, 1);
  assert.equal(a.summary(start + 86400_000).days.length, 2);
  assert.notEqual(
    a.data.days["2026-09-14"].visitors[0],
    a.data.days["2026-09-15"].visitors[0],
  );
  assert.equal(a.summary(start + 31 * 86400_000).days.length, 0);
});

test("API rejects malformed events, returns only aggregates and persists across restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "webmtv-audience-"));
  let app = Fastify();
  try {
    await registerAudience(app, dir);
    const post = (payload: unknown, headers = { "x-webmtv-audience": "1" }) =>
      app.inject({
        method: "POST",
        url: "/api/audience/heartbeat",
        payload: JSON.stringify(payload),
        headers: { "content-type": "application/json", ...headers },
      });
    assert.equal(
      (await post({ id, seconds: 0, visible: true }, {} as never)).statusCode,
      400,
    );
    for (const payload of [
      null,
      {},
      { id, seconds: -1, visible: true },
      { id, seconds: 31, visible: true },
      { id, seconds: 1, visible: "true" },
    ])
      assert.equal((await post(payload)).statusCode, 400);
    assert.equal(
      (await post({ id, seconds: 0, visible: true })).statusCode,
      204,
    );
    const response = await app.inject("/api/audience");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.json().today.browsers, 1);
    assert.equal(response.json().online, 1);
    assert.ok(!response.body.includes("visitors"));
    await app.close();
    assert.ok(
      !(await readFile(join(dir, "audience.json"), "utf8")).includes(id),
    );
    app = Fastify();
    await registerAudience(app, dir);
    const restored = (await app.inject("/api/audience")).json();
    assert.equal(restored.today.browsers, 1);
    assert.equal(restored.online, 0);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
