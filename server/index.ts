import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { resolve } from "node:path";
import { boards, catalog } from "./source.js";
import { createFeed, jobs } from "./feed.js";
import {
  library,
  libraryReady,
  rememberCatalog,
  warmLibrary,
} from "./library.js";
import type { Source } from "../shared/model.js";
import { localHosts, permitted } from "./access.js";
const app = Fastify({
  logger: process.env.LOG_REQUESTS === "1",
  bodyLimit: 32_768,
});
app.addHook("onRequest", async (req, reply) => {
  if (!permitted(req.headers.host || "", req.headers.origin))
    return reply.code(403).send({ error: "Host or origin rejected" });
});
app.setErrorHandler((e, _req, reply) =>
  reply
    .code(502)
    .send({ error: e instanceof Error ? e.message : "Ошибка сервера" }),
);
app.get("/api/health", async () => ({ ok: true }));
app.get<{ Querystring: { minimum?: string } }>("/api/tree", async (req) => {
  const minimum = Math.max(0, Math.min(86400, Number(req.query.minimum) || 0));
  await libraryReady;
  warmLibrary();
  const registry = (await boards()).map((b) => library.board(b, minimum));
  return {
    boards: registry,
    index: {
      readyBoards: registry.filter((b) => b.videoCount).length,
      pendingBoards: registry.filter((b) => b.videoState === "unknown").length,
    },
  };
});
app.get<{ Params: { board: string }; Querystring: { minimum?: string } }>(
  "/api/boards/:board",
  async (req, reply) => {
    if (!(await boards()).some((b) => b.id === req.params.board))
      return reply.code(404).send({ error: "Доска не найдена" });
    await libraryReady;
    rememberCatalog(req.params.board, await catalog(req.params.board));
    warmLibrary(req.params.board);
    return {
      topics: library.topics(
        req.params.board,
        Math.max(0, Math.min(86400, Number(req.query.minimum) || 0)),
      ),
    };
  },
);
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
const shutdown = () => {
  void app.close().then(() => process.exit(0));
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
