import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { resolve } from "node:path";
import { boards, catalog } from "./source.js";
import { createFeed, jobs } from "./feed.js";
import {
  library,
  libraryReady,
  flushLibrary,
  rememberCatalog,
  warmLibrary,
} from "./library.js";
import type { Source } from "../shared/model.js";
import { localHosts, permitted } from "./access.js";
import {
  publicOrigin,
  publicAccess,
  validSources,
  sampleRadio,
} from "./public.js";
import { Snapshots, type Snapshot } from "./snapshots.js";
import {
  PUBLIC_MINIMUMS,
  RADIO_BUCKETS,
  type RadioBatch,
} from "../shared/radio.js";
import { validClipAddress } from "../shared/share.js";
const snapshots = new Snapshots();
function sendSnapshot<T>(
  req: FastifyRequest,
  reply: FastifyReply,
  item: Snapshot<T>,
) {
  const remaining = Math.max(
    1,
    Math.min(30, Math.ceil((item.expires - Date.now()) / 1000)),
  );
  reply.header(
    "Cache-Control",
    `public, max-age=${remaining}, s-maxage=${remaining}, stale-while-revalidate=30, stale-if-error=300`,
  );
  reply.header("ETag", item.etag);
  if (
    req.headers["if-none-match"]
      ?.split(",")
      .some(
        (tag) =>
          tag.trim().replace(/^W\//, "") === item.etag || tag.trim() === "*",
      )
  )
    return reply.code(304).send();
  return reply.type("application/json; charset=utf-8").send(item.body);
}
function batch(
  source: Source,
  adult: boolean,
  minimum: number,
  bucket: number,
  registry: Awaited<ReturnType<typeof boards>>,
) {
  const key = JSON.stringify([
    "radio",
    source.kind,
    source.board || "",
    source.kind === "root" ? "all" : source.id,
    adult,
    minimum,
    bucket,
  ]);
  return snapshots.get<RadioBatch>(
    key,
    () => {
      const clips = sampleRadio(
        library,
        registry,
        [source],
        adult,
        minimum,
        new Set(),
      );
      const entry =
        source.kind === "thread"
          ? library.data[source.board!]?.topics[source.id]
          : undefined;
      const pending =
        source.kind === "thread" &&
        (!entry?.checkedAt || !!entry.stale || !!entry.error);
      return { clips, complete: clips.length < 96, pending };
    },
    Date.now(),
    (value) => (value.clips.length ? 60_000 : 5000),
  );
}
const app = Fastify({
  requestTimeout: 15_000,
  connectionTimeout: 10_000,
  logger: process.env.LOG_REQUESTS === "1",
  bodyLimit: 32_768,
  forceCloseConnections: true,
});
app.addHook("onRequest", async (req, reply) => {
  if (
    !(publicOrigin
      ? publicAccess(req.headers.host || "", req.headers.origin, req.ip)
      : permitted(req.headers.host || "", req.headers.origin))
  )
    return reply.code(403).send({ error: "Host or origin rejected" });
  if (
    publicOrigin &&
    req.method === "GET" &&
    /^\/api\/(tree|boards\/|radio\/)/.test(req.url)
  ) {
    const query = req.query as Record<string, string>;
    const allowed = req.url.startsWith("/api/radio/")
      ? ["minimum", "adult"]
      : ["minimum"];
    if (
      Object.keys(query).some((key) => !allowed.includes(key)) ||
      (query.minimum !== undefined &&
        !PUBLIC_MINIMUMS.map(String).includes(query.minimum))
    )
      return reply.code(400).send({ error: "Некорректные параметры" });
  }
  if (
    publicOrigin &&
    (req.url.startsWith("/api/feeds") || req.url.startsWith("/api/shutdown"))
  )
    return reply.code(404).send({ error: "Not found" });
});
app.setErrorHandler((e, _req, reply) =>
  reply
    .code(
      typeof (e as { statusCode?: number }).statusCode === "number"
        ? (e as { statusCode: number }).statusCode
        : 502,
    )
    .send({ error: e instanceof Error ? e.message : "Ошибка сервера" }),
);
const version = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
const shutdownToken = randomUUID();
let revision = "local";
try {
  revision = JSON.parse(
    readFileSync(new URL("../build.json", import.meta.url), "utf8"),
  ).revision;
} catch {}
app.get("/api/health", async () => ({
  ok: true,
  app: "webm-tv",
  version,
  revision,
  public: !!publicOrigin,
}));
app.get("/api/system", async (_req, reply) => {
  reply.header("Cache-Control", "no-store");
  if (publicOrigin) return { version, public: true, url: publicOrigin };
  return {
    public: false,
    version,
    localhost: "http://localhost:4173",
    lan:
      bindHost === "0.0.0.0"
        ? [...localHosts()]
            .filter((h) => h !== "localhost" && !h.startsWith("127."))
            .map((h) => `http://${h}:4173`)
        : [],
    shutdownToken,
  };
});
app.post("/api/shutdown", async (req, reply) => {
  if (req.headers["x-webmtv-shutdown"] !== shutdownToken)
    return reply.code(403).send({ error: "Откройте панель питания заново." });
  reply.raw.once("finish", () => {
    setTimeout(shutdown, 100);
  });
  return { ok: true };
});
app.get<{ Querystring: { minimum?: string } }>(
  "/api/tree",
  async (req, reply) => {
    const minimum = Math.max(
      0,
      Math.min(86400, Number(req.query.minimum) || 0),
    );
    if (publicOrigin && !PUBLIC_MINIMUMS.includes(minimum))
      return reply.code(400).send({ error: "Некорректная длительность" });
    await libraryReady;
    warmLibrary();
    const sourceBoards = await boards();
    const compute = () => {
      const registry = sourceBoards.map((b) => {
        const entry = library.board(b, minimum);
        return publicOrigin
          ? { ...entry, samples: entry.samples?.slice(0, 2) }
          : entry;
      });
      return {
        boards: registry,
        index: {
          readyBoards: registry.filter((b) => b.videoCount).length,
          pendingBoards: registry.filter((b) => b.videoState === "unknown")
            .length,
        },
      };
    };
    return publicOrigin
      ? sendSnapshot(
          req,
          reply,
          snapshots.get("tree:" + minimum, compute, Date.now(), (value) =>
            value.index.readyBoards ? 60_000 : 5000,
          ),
        )
      : compute();
  },
);
app.get<{ Params: { board: string }; Querystring: { minimum?: string } }>(
  "/api/boards/:board",
  async (req, reply) => {
    const minimum = Math.max(
      0,
      Math.min(86400, Number(req.query.minimum) || 0),
    );
    if (publicOrigin && !PUBLIC_MINIMUMS.includes(minimum))
      return reply.code(400).send({ error: "Некорректная длительность" });
    if (!(await boards()).some((b) => b.id === req.params.board))
      return reply.code(404).send({ error: "Доска не найдена" });
    await libraryReady;
    if (!publicOrigin)
      rememberCatalog(req.params.board, await catalog(req.params.board));
    warmLibrary(req.params.board);
    const compute = () => ({
      topics: library
        .topics(req.params.board, minimum)
        .map((t) =>
          publicOrigin ? { ...t, samples: t.samples?.slice(0, 1) } : t,
        ),
    });
    return publicOrigin
      ? sendSnapshot(
          req,
          reply,
          snapshots.get(
            `board:${req.params.board}:${minimum}`,
            compute,
            Date.now(),
            (value) => (value.topics.some((t) => t.videoCount) ? 60_000 : 5000),
          ),
        )
      : compute();
  },
);
app.get<{ Params: { board: string; thread: string; file: string } }>(
  "/api/clips/:board/:thread/:file",
  async (req, reply) => {
    const { board, thread, file } = req.params;
    if (!validClipAddress(board, thread, file))
      return reply.code(400).send({ error: "Некорректная ссылка на ролик" });
    await libraryReady;
    const entry = Object.hasOwn(library.data, board)
      ? library.data[board]
      : undefined;
    const clip = entry?.topics[thread]?.clips.find(
      (c) => new URL(c.url).pathname.split("/").pop() === file,
    );
    if (!clip)
      return reply.code(404).send({
        error:
          "Ролик больше не доступен в каталоге. Можно посмотреть общий эфир.",
      });
    reply.header("Cache-Control", "public, max-age=60");
    return {
      clip,
      adult: !!(await boards()).find((b) => b.id === board)?.adult,
    };
  },
);
app.get<{
  Params: { kind: string; id: string; bucket: string };
  Querystring: { adult?: string; minimum?: string };
}>("/api/radio/:kind/:id/:bucket", async (req, reply) => {
  if (!publicOrigin) return reply.code(404).send({ error: "Not found" });
  const { kind, id, bucket: rawBucket } = req.params;
  const minimum = Number(req.query.minimum || 0);
  const bucket = Number(rawBucket);
  if (
    !/^[0-7]$/.test(rawBucket) ||
    bucket >= RADIO_BUCKETS ||
    !PUBLIC_MINIMUMS.includes(minimum) ||
    !["0", "1"].includes(req.query.adult || "0") ||
    id.length > 200
  )
    return reply.code(400).send({ error: "Некорректная порция эфира" });
  const registry = await boards();
  const [board, thread] = id.split(".");
  let source: Source;
  if (kind === "root" && id === "all") source = { kind, id, label: "" };
  else if (kind === "category" && registry.some((b) => b.category === id))
    source = { kind, id, label: "" };
  else if (kind === "board" && registry.some((b) => b.id === id))
    source = { kind, id, label: "" };
  else if (
    kind === "thread" &&
    /^[a-z0-9_]+\.\d+$/.test(id) &&
    registry.some((b) => b.id === board)
  )
    source = { kind, board, id: thread, label: "" };
  else return reply.code(404).send({ error: "Источник не найден" });
  await libraryReady;
  if (source.kind === "thread" && !library.data[board]?.topics[thread])
    return reply.code(404).send({ error: "Тред ещё не найден в каталоге" });
  warmLibrary(
    source.kind === "board" ? source.id : source.board,
    source.kind === "thread" ? source.id : undefined,
  );
  return sendSnapshot(
    req,
    reply,
    batch(source, req.query.adult === "1", minimum, bucket, registry),
  );
});
app.post("/api/radio", async (req, reply) => {
  if (!publicOrigin) return reply.code(404).send({ error: "Not found" });
  const body = req.body as {
    sources?: Source[];
    includeAdult?: boolean;
    minimum?: number;
    exclude?: string[];
  };
  if (
    !validSources(body?.sources) ||
    typeof body.includeAdult !== "boolean" ||
    (body.minimum !== undefined &&
      (!Number.isFinite(body.minimum) ||
        body.minimum < 0 ||
        body.minimum > 86400)) ||
    (body.exclude !== undefined &&
      (!Array.isArray(body.exclude) ||
        body.exclude.length > 200 ||
        body.exclude.some((x) => typeof x !== "string" || x.length > 200)))
  )
    return reply.code(400).send({ error: "Некорректные источники" });
  await libraryReady;
  warmLibrary();
  const registry = await boards();
  if (
    !PUBLIC_MINIMUMS.includes(body.minimum || 0) ||
    body.sources.some((s) =>
      s.kind === "category"
        ? !registry.some((b) => b.category === s.id)
        : s.kind === "board"
          ? !registry.some((b) => b.id === s.id)
          : s.kind === "thread"
            ? !registry.some((b) => b.id === s.board)
            : false,
    )
  )
    return reply.code(400).send({ error: "Источник не найден" });
  // Compatibility for already-open clients. New clients fetch shared GET batches.
  const excluded = new Set(body.exclude || []);
  const candidates = body.sources.flatMap(
    (source) =>
      batch(
        source,
        body.includeAdult!,
        body.minimum || 0,
        Math.floor(Math.random() * RADIO_BUCKETS),
        registry,
      ).value.clips,
  );
  const clips = [
    ...new Map(
      candidates.filter((c) => !excluded.has(c.id)).map((c) => [c.id, c]),
    ).values(),
  ];
  for (let i = clips.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clips[i], clips[j]] = [clips[j], clips[i]];
  }
  return { clips: clips.slice(0, 96) };
});
app.post("/api/feeds", async (req, reply) => {
  const b = req.body as { sources?: Source[]; includeAdult?: boolean };
  if (
    !Array.isArray(b?.sources) ||
    !b.sources.length ||
    b.sources.length > 100 ||
    typeof b.includeAdult !== "boolean" ||
    b.sources.some(
      (s) =>
        !s ||
        !["root", "category", "board", "thread"].includes(s.kind) ||
        typeof s.id !== "string" ||
        s.id.length > 100 ||
        typeof s.label !== "string" ||
        s.label.length > 200 ||
        (s.kind === "thread" &&
          (!/^[a-z0-9_]+$/.test(s.board || "") || !/^\d+$/.test(s.id))),
    )
  )
    return reply.code(400).send({ error: "Некорректные источники" });
  const j = createFeed(b.sources, b.includeAdult);
  return { id: j.id };
});
app.get<{ Params: { id: string }; Querystring: { offset?: string } }>(
  "/api/feeds/:id",
  async (req, reply) => {
    const j = jobs.get(req.params.id);
    if (!j)
      return reply.code(404).send({ error: "Эфир завершён. Обновите список." });
    j.touch = Date.now();
    const offset = Math.max(0, Number(req.query.offset) || 0);
    return {
      id: j.id,
      clips: j.clips.slice(offset, offset + 500),
      nextOffset: Math.min(j.clips.length, offset + 500),
      total: j.clips.length,
      progress: j.progress,
      issues: j.issues,
    };
  },
);
app.delete<{ Params: { id: string } }>("/api/feeds/:id", async (req) => {
  const j = jobs.get(req.params.id);
  if (j) j.stopped = true;
  jobs.delete(req.params.id);
  return { ok: true };
});
await app.register(fastifyStatic, { root: resolve("dist"), wildcard: true });
app.setNotFoundHandler((req, reply) =>
  req.url.startsWith("/api/")
    ? reply.code(404).send({ error: "Not found" })
    : reply.sendFile("index.html"),
);
await libraryReady;
const bindHost = process.env.HOST || "0.0.0.0";
try {
  await app.listen({ host: bindHost, port: 4173 });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "EADDRINUSE")
    console.error(
      "Port 4173 is already in use. WebM TV may already be running: http://localhost:4173",
    );
  else console.error(error);
  process.exit(1);
}
console.log("\nWebM TV is ready\n");
console.log("  This computer: http://localhost:4173");
if (bindHost === "0.0.0.0")
  for (const host of localHosts()) {
    if (!["localhost", "127.0.0.1"].includes(host))
      console.log("  Local network: http://" + host + ":4173");
  }
console.log(
  "\nOpen a local-network address on your phone using the same Wi-Fi.",
);
console.log("Keep this window open. Press Ctrl+C to stop.\n");
let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  for (const job of jobs.values()) job.stopped = true;
  const deadline = setTimeout(() => process.exit(0), 5000);
  deadline.unref();
  void app
    .close()
    .then(flushLibrary)
    .finally(() => process.exit(0));
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
