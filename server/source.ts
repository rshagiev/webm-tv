import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  stat,
  unlink,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import he from "he";
import type { Board, Clip, Topic } from "../shared/model.js";
const HOST = process.env.SOURCE_HOST || "2ch.hk";
if (!["2ch.hk", "2ch.su"].includes(HOST))
  throw new Error("SOURCE_HOST must be 2ch.hk or 2ch.su");
export const origin = `https://${HOST}`;
export const plain = (s: unknown) =>
  he
    .decode(String(s || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
const pending = new Map<string, Promise<any>>();
let pruning: Promise<void> | undefined;
async function pruneCache() {
  if (pruning) return pruning;
  pruning = (async () => {
    const files = await readdir("data/cache").catch(() => [] as string[]);
    const entries = (
      await Promise.all(
        files
          .filter((f) => /^[a-f0-9]{64}\.json$/.test(f))
          .map(async (name) => {
            const path = "data/cache/" + name;
            try {
              const info = await stat(path);
              return { path, size: info.size, time: info.mtimeMs };
            } catch {
              return null;
            }
          }),
      )
    )
      .filter((e): e is { path: string; size: number; time: number } => !!e)
      .sort((a, b) => a.time - b.time);
    let size = entries.reduce((n, e) => n + e.size, 0);
    for (const e of entries)
      if (size > 128 * 1024 * 1024 || Date.now() - e.time > 86400_000) {
        await unlink(e.path).catch(() => {});
        size -= e.size;
      }
  })();
  try {
    await pruning;
  } finally {
    pruning = undefined;
  }
}
let active = 0;
const waiters: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>((r) => waiters.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}
export async function json(path: string, ttl = 300_000): Promise<any> {
  if (!/^\/[a-zA-Z0-9/_.-]+\.json$/.test(path))
    throw new Error("Invalid source path");
  if (pending.has(path)) return pending.get(path);
  const task = (async () => {
    const key = createHash("sha256")
      .update(origin + path)
      .digest("hex");
    const file = `data/cache/${key}.json`;
    try {
      const c = JSON.parse(await readFile(file, "utf8"));
      if (Date.now() - c.at < ttl) return c.value;
    } catch {}
    const value = await limited(async () => {
      const response = await fetch(origin + path, {
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: "application/json", "User-Agent": "WebM-TV/0.1" },
        redirect: "error",
      });
      if (!response.ok) throw new Error(`Источник: HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > 20_000_000)
        throw new Error("Ответ источника слишком большой");
      return JSON.parse(text);
    });
    await mkdir("data/cache", { recursive: true });
    await writeFile(file + ".tmp", JSON.stringify({ at: Date.now(), value }));
    await rename(file + ".tmp", file);
    await pruneCache().catch(() => {});
    return value;
  })();
  pending.set(path, task);
  try {
    return await task;
  } finally {
    pending.delete(path);
  }
}
export function parseBoards(data: any): Board[] {
  if (!Array.isArray(data.boards))
    throw new Error("Не удалось прочитать список досок");
  return data.boards
    .filter((b: any) => /^[a-z0-9_]+$/.test(b.id))
    .map((b: any) => ({
      id: b.id,
      name: plain(b.name) || b.id,
      category: plain(b.category) || "Без категории",
      adult: b.category === "Взрослым",
      threads: Number(b.threads) || 0,
      video: (b.file_types || []).some(
        (x: string) => x === "webm" || x === "mp4",
      ),
    }));
}
export const boards = async () =>
  parseBoards(await json("/index.json", 3600_000));
export function mediaUrl(path: unknown): string | undefined {
  if (typeof path !== "string") return;
  try {
    const u = new URL(path, origin);
    if (
      !["2ch.hk", "2ch.su"].includes(u.hostname) ||
      u.protocol !== "https:" ||
      !/^\/[a-z0-9_]+\/(src|thumb)\//.test(u.pathname) ||
      !/\.(mp4|webm)$/i.test(u.pathname)
    )
      return;
    return u.href;
  } catch {
    return;
  }
}
export function extract(
  posts: any[],
  board: string,
  thread: string,
  title: string,
): Clip[] {
  return posts.flatMap((p) =>
    (p.files || []).flatMap((f: any) => {
      const url = mediaUrl(f.path);
      if (!url) return [];
      return [
        {
          id: f.md5 ? `md5:${f.md5}` : url,
          url,
          duration: Number(f.duration_secs) || 0,
          board,
          thread,
          post: String(p.num),
          title,
          width: Number(f.width) || 0,
          height: Number(f.height) || 0,
        },
      ];
    }),
  );
}
export async function catalog(board: string) {
  if (!/^[a-z0-9_]+$/.test(board)) throw new Error("Invalid board");
  const data = await json(`/${board}/catalog.json`);
  if (!Array.isArray(data.threads)) throw new Error("Каталог недоступен");
  const topics: Topic[] = data.threads.map((t: any) => ({
    id: String(t.num),
    board,
    title: (plain(t.subject) || plain(t.comment) || `Тред №${t.num}`).slice(
      0,
      180,
    ),
    posts: Number(t.posts_count) || 0,
    files: Number(t.files_count) || 0,
    opVideos: extract([t], board, String(t.num), "").length,
    updated: Number(t.lasthit) || Number(t.timestamp) || 0,
  }));
  const clips = data.threads.flatMap((t: any, i: number) =>
    extract([t], board, String(t.num), topics[i].title),
  );
  return { topics, clips };
}
export async function thread(board: string, id: string) {
  if (!/^[a-z0-9_]+$/.test(board) || !/^\d+$/.test(id))
    throw new Error("Invalid thread");
  const data = await json(`/${board}/res/${id}.json`);
  if (!Array.isArray(data.threads))
    throw new Error("Тред недоступен или удалён");
  const posts = data.threads.flatMap((t: any) => t.posts || []);
  const op = posts[0];
  return extract(
    posts,
    board,
    id,
    (plain(op?.subject) || plain(op?.comment) || `Тред №${id}`).slice(0, 180),
  );
}
