import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { origin } from "./source.js";
import { sourceSession } from "./source-session.js";
import { validMediaPath } from "../shared/media.js";

export async function sourceMedia(
  path: string,
  method: string,
  headers: Record<string, string>,
  signal: AbortSignal,
) {
  let url = origin + path;
  for (let redirects = 0; redirects <= 2; redirects++) {
    const response = await fetch(url, {
      method,
      headers,
      redirect: "manual",
      signal,
    });
    if (![301, 302, 303, 307, 308].includes(response.status))
      return { response, url };
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || redirects === 2) throw new Error("redirect");
    const next = new URL(location, url);
    if (
      next.protocol !== "https:" ||
      !["2ch.hk", "2ch.su"].includes(next.host) ||
      next.username ||
      next.password ||
      next.pathname !== path ||
      next.search ||
      next.hash
    )
      throw new Error("redirect");
    url = next.href;
  }
  throw new Error("redirect");
}
const isVideo = (r: Response) =>
  [200, 206].includes(r.status) &&
  /^(video\/(mp4|webm)|application\/octet-stream)(;|$)/i.test(
    r.headers.get("content-type") || "",
  );

export function registerMedia(app: FastifyInstance) {
  let active = 0;
  const clients = new Map<string, number>();
  const direct = new Map<string, { until: number; url?: string }>();
  app.route<{ Params: { "*": string } }>({
    method: ["GET", "HEAD"],
    url: "/api/media/*",
    async handler(req, reply) {
      const path = "/" + req.params["*"];
      if (!validMediaPath(path))
        return reply.code(400).send({ error: "Некорректный адрес видео" });
      const session = await sourceSession();
      if (!session.headers.Cookie) return reply.redirect(origin + path);
      const range = req.headers.range;
      if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range))
        return reply.code(416).send();
      if (active >= 32 || (clients.get(req.ip) || 0) >= 6)
        return reply
          .header("Retry-After", "3")
          .code(429)
          .send({ error: "Сервер занят. Повторите через несколько секунд" });
      active++;
      clients.set(req.ip, (clients.get(req.ip) || 0) + 1);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        active--;
        const remaining = (clients.get(req.ip) || 1) - 1;
        if (remaining) clients.set(req.ip, remaining);
        else clients.delete(req.ip);
      };
      reply.raw.once("close", release);
      reply.raw.once("finish", release);
      const controller = new AbortController();
      const abort = () => controller.abort();
      reply.raw.once("close", abort);
      const timer = setTimeout(abort, 15_000);
      let response: Response | undefined;
      try {
        let cached = direct.get(path);
        if (!cached || cached.until < Date.now()) {
          const anonymous = await sourceMedia(
            path,
            "HEAD",
            {},
            controller.signal,
          );
          cached = {
            until: Date.now() + 300_000,
            url: isVideo(anonymous.response) ? anonymous.url : undefined,
          };
          await anonymous.response.body?.cancel();
          if (direct.size >= 2048) direct.delete(direct.keys().next().value!);
          direct.set(path, cached);
        }
        if (cached.url)
          return reply
            .header("Cache-Control", "private, no-store")
            .redirect(cached.url);
        const upstream = await sourceMedia(
          path,
          req.method,
          {
            ...session.headers,
            ...(range ? { Range: range } : {}),
            ...(typeof req.headers["if-range"] === "string"
              ? { "If-Range": req.headers["if-range"] }
              : {}),
          },
          controller.signal,
        );
        response = upstream.response;
        clearTimeout(timer);
        if (response?.status === 416) {
          await response.body?.cancel();
          reply.header("Cache-Control", "private, no-store");
          const contentRange = response.headers.get("content-range");
          if (contentRange) reply.header("Content-Range", contentRange);
          return reply.code(416).send();
        }
        if (
          !response ||
          ![200, 206].includes(response.status) ||
          !/^(video\/(mp4|webm)|application\/octet-stream)(;|$)/i.test(
            response.headers.get("content-type") || "",
          )
        )
          throw new Error("unavailable");
        for (const name of [
          "content-type",
          "content-length",
          "content-range",
          "accept-ranges",
          "etag",
          "last-modified",
        ]) {
          const value = response.headers.get(name);
          if (value) reply.header(name, value);
        }
        reply.header("Cache-Control", "private, no-store");
        reply.code(response.status);
        if (req.method === "HEAD" || !response.body) {
          await response.body?.cancel();
          return reply.send();
        }
        // Backpressure and client disconnects stop the upstream read; no media archive.
        const stream = Readable.fromWeb(
          response.body as import("node:stream/web").ReadableStream,
        );
        stream.once("close", () => {
          reply.raw.off("close", abort);
          controller.abort();
        });
        return reply.send(stream);
      } catch {
        await response?.body?.cancel().catch(() => {});
        controller.abort();
        return reply.code(502).send({ error: "Источник не предоставил видео" });
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
