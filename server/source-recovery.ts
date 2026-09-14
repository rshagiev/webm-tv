import { randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
const origin = "https://2ch.su";
import {
  accessStatus,
  catalogAccessible,
  invalidateAccess,
} from "./source-access.js";
import { saveSourceSession } from "./source-session.js";

// No personal browser cookie is used for this session. Only explicit UI actions post.
type Attempt = {
  token: string;
  until: number;
  phase: "captcha" | "solved" | "submitted" | "uncertain" | "verified";
  jar: Record<string, string>;
  id: string;
  key?: string;
  challenge?: { template: string; limit: number; hash: string };
  image?: string;
  keyboard?: string[];
  post?: string;
  thread: string;
};
type Dependencies = {
  status: typeof accessStatus;
  verify: typeof catalogAccessible;
  save: typeof saveSourceSession;
  fetch: typeof fetch;
  now: () => number;
};
const picture = (x: unknown): x is string =>
  typeof x === "string" &&
  x.length < 1_000_000 &&
  /^[A-Za-z0-9+/=\r\n]+$/.test(x);
export class SourceRecovery {
  private attempt?: Attempt;
  private busy = false;
  private cooldown = 0;
  private ready: Promise<void>;
  private readonly file: string;
  constructor(
    private deps: Dependencies = {
      status: accessStatus,
      verify: catalogAccessible,
      save: saveSourceSession,
      fetch: (...args) => fetch(...args),
      now: Date.now,
    },
    dir = process.env.WEBMTV_DATA_DIR || "data",
  ) {
    const file = resolve(dir, "source-recovery.json");
    this.file = file;
    this.ready = (async () => {
      try {
        const stored = JSON.parse(await readFile(file, "utf8"));
        this.cooldown = stored.cooldown || 0;
        // A submitted operation is never replayed after a crash.
        if (stored.attempt?.until > this.deps.now()) {
          this.attempt = stored.attempt;
          if (this.attempt?.phase === "submitted")
            this.attempt.phase = "uncertain";
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT")
          throw new Error("Не удалось прочитать состояние восстановления");
      }
    })();
  }
  private async persist() {
    await mkdir(resolve(this.file, ".."), { recursive: true });
    await writeFile(
      this.file + ".new",
      JSON.stringify({ cooldown: this.cooldown, attempt: this.attempt }),
      { mode: 0o600 },
    );
    await rename(this.file + ".new", this.file);
  }
  private view(a: Attempt) {
    return {
      token: a.token,
      phase: a.phase,
      expiresAt: a.until,
      image: a.image,
      keyboard: a.keyboard,
      threadUrl: `${origin}/test/res/${a.thread}.html`,
      postUrl: a.post
        ? `${origin}/test/res/${a.thread}.html#${a.post}`
        : undefined,
    };
  }
  async info() {
    await this.ready;
    return {
      status: await this.deps.status(),
      helping:
        !!this.attempt &&
        this.attempt.phase !== "verified" &&
        this.attempt.until > this.deps.now(),
      retryAt: this.cooldown,
    };
  }
  private async exclusive<T>(fn: () => Promise<T>) {
    await this.ready;
    if (this.busy) throw new Error("Дождитесь завершения предыдущего действия");
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }
  private async request(a: Attempt, path: string, init?: RequestInit) {
    const response = await this.deps.fetch(origin + path, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        ...init?.headers,
        Cookie: Object.entries(a.jar)
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
      },
    });
    for (const c of response.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (
        eq > 0 &&
        /^[a-zA-Z0-9_]+$/.test(name) &&
        value.length <= 4096 &&
        Object.keys(a.jar).length < 20
      )
        a.jar[name] = value;
    }
    // Save any issued cookie before attempting JSON parsing or verification.
    await this.persist();
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Двач не ответил. Повторите проверку позже");
    }
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error("Ответ Двача слишком большой");
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Двач вернул неожиданный ответ");
    }
  }
  async start() {
    return this.exclusive(async () => {
      if ((await this.deps.status()) !== "needs-help")
        throw new Error(
          "Сейчас восстановление не требуется или Двач недоступен",
        );
      if (this.cooldown > this.deps.now())
        throw new Error("Восстановление уже начато. Подождите несколько минут");
      // Resolve a current test thread; never create a new thread or accept arbitrary destinations.
      const r = await this.deps.fetch(origin + "/test/catalog.json", {
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
      if (!r.ok) throw new Error("Тестовый раздел Двача недоступен");
      const d = await r.json();
      const thread = d.threads?.find(
        (t: any) =>
          !t.closed &&
          /^\d+$/.test(String(t.num)) &&
          Number(t.posts_count) < 400,
      );
      if (!thread) throw new Error("Не найден открытый тестовый тред");
      const a: Attempt = {
        token: randomBytes(24).toString("hex"),
        until: this.deps.now() + 300_000,
        phase: "captcha",
        jar: {},
        id: "",
        thread: String(thread.num),
      };
      this.attempt = a;
      this.cooldown = this.deps.now() + 300_000;
      await this.persist();
      const initial = await this.request(a, "/api/captcha/emoji/id");
      if (initial.result !== 1 || typeof initial.id !== "string")
        throw new Error("Двач не выдал капчу. Попробуйте позже");
      a.id = initial.id;
      if (initial.challenge) {
        const c = initial.challenge;
        if (
          !Number.isInteger(c.limit) ||
          c.limit < 0 ||
          c.limit > 100_000 ||
          typeof c.template !== "string" ||
          c.template.length > 512 ||
          !/^[a-f0-9]{128}$/.test(c.hash)
        )
          throw new Error("Формат проверки Двача изменился");
        a.challenge = c;
      }
      this.setImages(
        a,
        await this.request(
          a,
          "/api/captcha/emoji/show?id=" + encodeURIComponent(a.id),
        ),
      );
      await this.persist();
      return this.view(a);
    });
  }
  private setImages(a: Attempt, data: any) {
    if (
      !picture(data.image) ||
      !Array.isArray(data.keyboard) ||
      data.keyboard.length < 1 ||
      data.keyboard.length > 16 ||
      !data.keyboard.every(picture)
    )
      throw new Error("Не удалось прочитать капчу");
    a.image = data.image;
    a.keyboard = data.keyboard;
  }
  private owned(token: unknown) {
    const a = this.attempt;
    if (
      !a ||
      typeof token !== "string" ||
      token !== a.token ||
      a.until < this.deps.now()
    )
      throw new Error("Попытка истекла. Начните восстановление заново");
    return a;
  }
  async click(token: unknown, index: unknown) {
    return this.exclusive(async () => {
      const a = this.owned(token);
      if (
        a.phase !== "captcha" ||
        !Number.isInteger(index) ||
        Number(index) < 0 ||
        Number(index) >= (a.keyboard?.length || 0)
      )
        throw new Error("Некорректный шаг капчи");
      const d = await this.request(a, "/api/captcha/emoji/click", {
        method: "POST",
        body: JSON.stringify({ captchaTokenID: a.id, emojiNumber: index }),
      });
      if (typeof d.success === "string" && d.success.length < 512) {
        a.key = d.success;
        a.phase = "solved";
        a.image = undefined;
        a.keyboard = undefined;
      } else this.setImages(a, d);
      await this.persist();
      return this.view(a);
    });
  }
  async submit(token: unknown) {
    return this.exclusive(async () => {
      const a = this.owned(token);
      if (a.phase !== "solved") return this.check(a);
      // Fixed, user-visible text and destination. No automatic retry of this POST.
      const body = new FormData();
      for (const [key, value] of Object.entries({
        task: "post",
        board: "test",
        thread: a.thread,
        comment: "test",
        captcha_type: "emoji_captcha",
        emoji_captcha_id: a.key!,
      }))
        body.set(key, value);
      if (a.challenge) {
        let solution: number | undefined;
        for (let i = 0; i < a.challenge.limit; i++) {
          if (
            createHash("sha512")
              .update(a.challenge.template.replace("%d", String(i)))
              .digest("hex") === a.challenge.hash
          ) {
            solution = i;
            break;
          }
        }
        if (solution === undefined) throw new Error("Проверка Двача устарела");
        body.set("2ch_challenge", String(solution));
      }
      a.phase = "submitted";
      a.until = this.deps.now() + 600_000;
      this.cooldown = a.until;
      await this.persist();
      try {
        const d = await this.request(a, "/user/posting?nc=1", {
          method: "POST",
          body,
        });
        if (d.result === 1 && /^\d+$/.test(String(d.num)))
          a.post = String(d.num);
        else {
          a.phase = "uncertain";
          await this.persist();
          throw new Error(
            "Двач не подтвердил отправку. Повторного поста не будет",
          );
        }
      } catch {
        a.phase = "uncertain";
        await this.persist();
        // A response may carry Set-Cookie even if the body could not be read.
      }
      return this.check(a);
    });
  }
  async resume(token: unknown) {
    await this.ready;
    return this.view(this.owned(token));
  }
  async verify(token: unknown) {
    return this.exclusive(() => this.check(this.owned(token)));
  }
  private async check(a: Attempt) {
    if (a.phase === "verified") return this.view(a);
    if (!["submitted", "uncertain"].includes(a.phase))
      throw new Error("Сначала решите капчу и отправьте test");
    const value = a.jar.usercode_auth;
    if (!value || !(await this.deps.verify(`usercode_auth=${value}`))) {
      a.phase = "uncertain";
      await this.persist();
      return this.view(a);
    }
    await this.deps.save(value);
    invalidateAccess();
    a.phase = "verified";
    a.jar = {};
    await this.persist();
    return this.view(a);
  }
}
export function registerRecovery(
  app: FastifyInstance,
  recovery = new SourceRecovery(),
) {
  app.get("/api/source-access", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    return recovery.info();
  });
  for (const action of [
    "start",
    "click",
    "submit",
    "verify",
    "resume",
  ] as const) {
    app.post<{ Body: { index?: number } }>(
      "/api/source-access/" + action,
      async (req, reply) => {
        reply.header("Cache-Control", "no-store");
        if (req.headers["x-webmtv-action"] !== "recover")
          return reply
            .code(403)
            .send({ error: "Откройте восстановление в WebM TV" });
        const token = req.headers["x-recovery-token"];
        try {
          return action === "start"
            ? await recovery.start()
            : action === "click"
              ? await recovery.click(token, req.body?.index)
              : await recovery[action](token);
        } catch (e) {
          return reply.code(409).send({
            error:
              e instanceof Error ? e.message : "Не удалось восстановить доступ",
          });
        }
      },
    );
  }
}
