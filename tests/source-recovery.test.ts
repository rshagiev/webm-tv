import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { SourceRecovery, registerRecovery } from "../server/source-recovery.js";

test("community attempt stays isolated, posts once, and installs only verified access", async () => {
  const dir = await mkdtemp(join(tmpdir(), "source-recovery-"));
  let posts = 0,
    saves = 0,
    allow = false;
  const image = "YWJj";
  const deps = {
    status: async () => "needs-help" as const,
    verify: async (cookie?: string) => {
      assert.equal(cookie, "usercode_auth=new-session");
      return allow;
    },
    save: async (value: string) => {
      assert.equal(value, "new-session");
      saves++;
    },
    now: () => 1000000,
    fetch: (async (url, init) => {
      const path = new URL(String(url)).pathname;
      assert.notEqual(
        new Headers(init?.headers).get("cookie"),
        "usercode_auth=personal-session",
      );
      if (path === "/test/catalog.json")
        return Response.json({
          threads: [{ num: 12, closed: 0, posts_count: 3 }],
        });
      if (path.endsWith("/id"))
        return Response.json({
          result: 1,
          id: "captcha",
          challenge: {
            limit: 3,
            template: "x%d",
            hash: createHash("sha512").update("x1").digest("hex"),
          },
        });
      if (path.endsWith("/show"))
        return Response.json({ image, keyboard: [image, image] });
      if (path.endsWith("/click")) {
        assert.deepEqual(JSON.parse(String(init?.body)), {
          captchaTokenID: "captcha",
          emojiNumber: 1,
        });
        return Response.json({ success: "solved-key" });
      }
      if (path === "/user/posting") {
        posts++;
        const form = init?.body as FormData;
        assert.equal(form.get("board"), "test");
        assert.equal(form.get("thread"), "12");
        assert.equal(form.get("comment"), "test");
        assert.equal(form.get("2ch_challenge"), "1");
        assert.equal(form.get("emoji_captcha_id"), "solved-key");
        const durable = JSON.parse(
          await readFile(join(dir, "source-recovery.json"), "utf8"),
        );
        assert.equal(durable.attempt.phase, "submitted");
        return Response.json(
          { result: 1, num: 42 },
          {
            headers: {
              "Set-Cookie": "usercode_auth=new-session; Path=/; HttpOnly",
            },
          },
        );
      }
      throw new Error("Unexpected request");
    }) as typeof fetch,
  };
  try {
    const recovery = new SourceRecovery(deps, dir);
    const app = Fastify();
    registerRecovery(app, recovery);
    assert.equal(
      (await app.inject({ method: "POST", url: "/api/source-access/start" }))
        .statusCode,
      403,
    );
    const a = await recovery.start();
    assert.equal((await recovery.info()).helping, true);
    assert.ok(!JSON.stringify(await recovery.info()).includes(a.token));
    await assert.rejects(recovery.start(), /уже начато/);
    await assert.rejects(recovery.click("wrong-token", 1));
    await assert.rejects(recovery.submit(a.token), /Сначала/);
    assert.equal(posts, 0);
    await recovery.click(a.token, 1);
    const submitted = await recovery.submit(a.token);
    assert.equal(submitted.phase, "uncertain");
    assert.equal(posts, 1);
    assert.equal(saves, 0);
    assert.ok(!JSON.stringify(submitted).includes("new-session"));
    assert.match(submitted.postUrl!, /#42$/);
    await recovery.submit(a.token);
    assert.equal(posts, 1);
    const restarted = new SourceRecovery(deps, dir);
    allow = true;
    assert.equal((await restarted.verify(a.token)).phase, "verified");
    assert.equal(saves, 1);
    await restarted.submit(a.token);
    assert.equal(posts, 1);
    assert.equal(saves, 1);
    await app.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
