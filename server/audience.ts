import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";

type Day = { visitors: string[]; watchSeconds: number };
type Saved = { version: 1; startedAt: string; days: Record<string, Day> };
const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);
export class Audience {
  data: Saved = { version: 1, startedAt: new Date().toISOString(), days: {} };
  private active = new Map<string, number>();
  private last = new Map<string, number>();
  private visitors = new Map<string, Set<string>>();
  heartbeat(id: string, seconds: number, visible: boolean, now = Date.now()) {
    const day = dayOf(now);
    this.prune(now);
    const hash = createHash("sha256").update(`${day}:${id}`).digest("hex");
    const entry = (this.data.days[day] ||= { visitors: [], watchSeconds: 0 });
    let seen = this.visitors.get(day);
    if (!seen) this.visitors.set(day, (seen = new Set(entry.visitors)));
    // Bound anonymous submissions even on a self-hosted server without nginx.
    if (!seen.has(hash) && seen.size >= 100_000) return false;
    if (!seen.has(hash)) {
      seen.add(hash);
      entry.visitors.push(hash);
    }
    const previous = this.last.get(hash);
    const midnight = Date.parse(`${day}T00:00:00Z`);
    if (previous !== undefined) {
      entry.watchSeconds += Math.max(
        0,
        Math.min(seconds, 30, (now - Math.max(previous, midnight)) / 1000),
      );
    }
    this.last.set(hash, now);
    if (visible) this.active.set(hash, now);
    // A hidden tab must not take another visible tab of this browser offline.
    return true;
  }
  prune(now = Date.now()) {
    const cutoff = dayOf(now - 29 * 86400_000);
    for (const day of Object.keys(this.data.days))
      if (day < cutoff) {
        delete this.data.days[day];
        this.visitors.delete(day);
      }
    for (const [id, time] of this.active)
      if (now - time >= 60_000) this.active.delete(id);
    for (const [id, time] of this.last)
      if (now - time >= 60_000) this.last.delete(id);
  }
  summary(now = Date.now()) {
    this.prune(now);
    const days = Object.entries(this.data.days)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, d]) => ({
        date,
        browsers: d.visitors.length,
        watchSeconds: Math.round(d.watchSeconds),
      }));
    return {
      startedAt: this.data.startedAt,
      timezone: "UTC",
      online: this.active.size,
      today: days.find((d) => d.date === dayOf(now)) || {
        date: dayOf(now),
        browsers: 0,
        watchSeconds: 0,
      },
      days,
    };
  }
}
export async function registerAudience(
  app: FastifyInstance,
  directory: string,
) {
  const audience = new Audience();
  const path = resolve(directory, "audience.json");
  try {
    const saved = JSON.parse(await readFile(path, "utf8"));
    if (
      saved.version !== 1 ||
      typeof saved.startedAt !== "string" ||
      !saved.days ||
      !Object.entries(saved.days).every(([day, value]) => {
        const d = value as Day;
        return (
          /^\d{4}-\d{2}-\d{2}$/.test(day) &&
          Array.isArray(d.visitors) &&
          d.visitors.length <= 100_000 &&
          d.visitors.every(
            (id) => typeof id === "string" && /^[a-f0-9]{64}$/.test(id),
          ) &&
          Number.isFinite(d.watchSeconds) &&
          d.watchSeconds >= 0
        );
      })
    )
      throw new Error("Invalid audience data");
    audience.data = saved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let dirty = false;
  let saving = Promise.resolve();
  function flush() {
    saving = saving
      .then(async () => {
        if (!dirty) return;
        audience.prune();
        const body = JSON.stringify(audience.data);
        dirty = false;
        try {
          await mkdir(directory, { recursive: true });
          await writeFile(`${path}.tmp`, body, { mode: 0o600 });
          await rename(`${path}.tmp`, path);
        } catch (error) {
          dirty = true;
          throw error;
        }
      })
      .catch((error) => {
        app.log.error(error, "Audience persistence failed");
      });
    return saving;
  }
  const timer = setInterval(() => {
    void flush();
  }, 30_000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await flush();
  });
  app.post(
    "/api/audience/heartbeat",
    { bodyLimit: 512 },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const b = req.body as {
        id?: unknown;
        seconds?: unknown;
        visible?: unknown;
      } | null;
      if (
        req.headers["x-webmtv-audience"] !== "1" ||
        !b ||
        typeof b.id !== "string" ||
        !/^[a-f0-9-]{36}$/.test(b.id) ||
        typeof b.seconds !== "number" ||
        !Number.isFinite(b.seconds) ||
        b.seconds < 0 ||
        b.seconds > 30 ||
        typeof b.visible !== "boolean"
      )
        return reply.code(400).send({ error: "Invalid heartbeat" });
      if (!audience.heartbeat(b.id, b.seconds, b.visible))
        return reply.code(429).send({ error: "Capacity reached" });
      dirty = true;
      return reply.code(204).send();
    },
  );
  app.get("/api/audience", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    return audience.summary();
  });
}
