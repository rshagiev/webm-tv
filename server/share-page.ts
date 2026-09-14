import type { FastifyInstance } from "fastify";
import type { Clip } from "../shared/model.js";
import { clipPath, validClipAddress } from "../shared/share.js";
import { sourceMedia } from "./media.js";
import { sourceSession } from "./source-session.js";

type Address = { board: string; thread: string; file: string };
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
export function shareHtml(html: string, clip: Clip, base: string) {
  const url = new URL(clipPath(clip), base).href;
  const image = new URL(
    clipPath(clip).replace("/watch/", "/api/preview/"),
    base,
  ).href;
  const title = `${clip.title} — WebM TV`;
  const tags = {
    "og:type": "video.other",
    "og:site_name": "WebM TV",
    "og:title": title,
    "og:description": `Ролик из /${clip.board}/ · Смотреть в WebM TV`,
    "og:url": url,
    "og:image": image,
    "og:image:alt": clip.title,
  };
  return html
    .replace(/<title>.*?<\/title>/s, `<title>${escape(title)}</title>`)
    .replace(
      "</head>",
      Object.entries(tags)
        .map(
          ([key, value]) =>
            `<meta property="${key}" content="${escape(value)}" />`,
        )
        .join("\n") + "\n</head>",
    );
}

export function registerSharePages(
  app: FastifyInstance,
  options: {
    find: (address: Address) => Promise<Clip | undefined>;
    html: () => string;
    publicOrigin?: string;
  },
) {
  app.get<{ Params: Address }>(
    "/watch/:board/:thread/:file",
    async (req, reply) => {
      const { board, thread, file } = req.params;
      if (!validClipAddress(board, thread, file))
        return reply.code(400).type("text/html").send(options.html());
      const clip = await options.find(req.params);
      if (!clip) return reply.code(404).type("text/html").send(options.html());
      return reply
        .header("Cache-Control", "public, max-age=60")
        .type("text/html")
        .send(
          shareHtml(
            options.html(),
            clip,
            options.publicOrigin || `${req.protocol}://${req.host}`,
          ),
        );
    },
  );
  let active = 0;
  app.get<{ Params: Address }>(
    "/api/preview/:board/:thread/:file",
    async (req, reply) => {
      const { board, thread, file } = req.params;
      if (!validClipAddress(board, thread, file)) return reply.code(400).send();
      if (!(await options.find(req.params))) return reply.code(404).send();
      if (active >= 8) return reply.code(429).header("Retry-After", "3").send();
      active++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      let response: Response | undefined;
      try {
        // 2ch's video thumbnail naming also works for previously indexed clips.
        const path = `/${board}/thumb/${thread}/${file.replace(/\.(mp4|webm)$/, "s.jpg")}`;
        ({ response } = await sourceMedia(
          path,
          "GET",
          (await sourceSession()).headers,
          controller.signal,
        ));
        if (
          !response.ok ||
          !/^image\/jpeg(?:;|$)/i.test(
            response.headers.get("content-type") || "",
          )
        )
          return reply.code(502).send();
        const chunks: Uint8Array[] = [];
        let size = 0;
        const reader = response.body!.getReader();
        while (true) {
          const { value: chunk, done } = await reader.read();
          if (done) break;
          size += chunk.length;
          if (size > 2 * 1024 * 1024) throw new Error("oversized thumbnail");
          chunks.push(chunk);
        }
        return reply
          .type("image/jpeg")
          .header("Cache-Control", "public, max-age=3600")
          .send(Buffer.concat(chunks));
      } catch {
        return reply.code(502).send();
      } finally {
        controller.abort();
        clearTimeout(timer);
        active--;
      }
    },
  );
}
