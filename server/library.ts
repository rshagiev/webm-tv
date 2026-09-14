import { resolve } from "node:path";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { boards, catalog, thread } from "./source.js";
import { CrawlQueue, catalogInterval } from "./crawl-queue.js";
import { VideoLibrary } from "./library-state.js";
import type { Clip, Topic, Board } from "../shared/model.js";
const dataDir = resolve(process.env.WEBMTV_DATA_DIR || "data");
export const library = new VideoLibrary();
export const libraryReady = (async () => {
  try {
    const saved = JSON.parse(
      await readFile(resolve(dataDir, "library.json"), "utf8"),
    );
    if (saved.version === 1) library.data = saved.boards;
  } catch {}
})();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving = Promise.resolve();
export async function flushLibrary() {
  await libraryReady;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = undefined;
  saving = saving
    .then(async () => {
      await mkdir(dataDir, { recursive: true });
      await writeFile(
        resolve(dataDir, "library.json.tmp"),
        JSON.stringify({ version: 1, boards: library.data }),
      );
      await rename(
        resolve(dataDir, "library.json.tmp"),
        resolve(dataDir, "library.json"),
      );
    })
    .catch((error) => {
      console.error("Index persistence failed:", error);
    });
  await saving;
}
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(
    () => {
      void flushLibrary();
    },
    process.env.PUBLIC_ORIGIN ? 60_000 : 2000,
  );
  saveTimer.unref();
}
export function rememberCatalog(
  board: string,
  data: { topics: Topic[]; clips: Clip[] },
) {
  library.catalog(board, data.topics, data.clips);
  persist();
}
export function rememberThread(board: string, id: string, clips: Clip[]) {
  library.thread(board, id, clips);
  persist();
}
let touched = 0,
  running = false;
const queue = new CrawlQueue();
const retryAfter = new Map<string, number>();
export function warmLibrary(board?: string, threadId?: string) {
  touched = Date.now();
  if (board) queue.request(board, threadId, touched);
  if (!running) {
    running = true;
    void warm()
      .catch((error) => console.error("Index crawl failed:", error.message))
      .finally(() => {
        running = false;
      });
  }
}
async function warm() {
  await libraryReady;
  let registry: Board[] = [],
    registryAt = 0,
    turns = 0;
  while (
    Date.now() - touched <
    (process.env.PUBLIC_ORIGIN ? 180_000 : 25_000)
  ) {
    let now = Date.now();
    if (!registryAt || now - registryAt >= 60_000) {
      try {
        registry = (await boards()).filter((b) => b.video);
        registryAt = now;
      } catch {
        if (!registry.length) return;
        registryAt = now;
      }
    }
    for (const [key, until] of retryAfter)
      if (until <= now) retryAfter.delete(key);
    const missing = registry.some((b) => !library.data[b.id]?.at);
    const nextBoard =
      missing || turns++ % 3 === 0
        ? registry
            .filter(
              (b) =>
                (retryAfter.get(b.id) || 0) <= now &&
                (!library.data[b.id]?.at ||
                  now - library.data[b.id].at >= catalogInterval(b)),
            )
            .sort((a, b) => {
              const overdue = (x: Board) =>
                library.data[x.id]?.at
                  ? (now - library.data[x.id].at) / catalogInterval(x)
                  : Infinity;
              return overdue(b) - overdue(a) || a.id.localeCompare(b.id);
            })[0]
        : undefined;
    if (nextBoard) {
      try {
        rememberCatalog(
          nextBoard.id,
          await catalog(nextBoard.id, catalogInterval(nextBoard)),
        );
      } catch {
        retryAfter.set(nextBoard.id, Date.now() + 60_000);
      }
    }
    now = Date.now();
    const task = queue.pick(library.data, registry, retryAfter, now);
    if (task) {
      const { board, entry } = task;
      try {
        rememberThread(
          board,
          entry.topic.id,
          await thread(board, entry.topic.id, 60_000),
        );
      } catch (error) {
        library.failure(board, entry.topic.id, (error as Error).message);
        persist();
        retryAfter.set(board + ":" + entry.topic.id, Date.now() + 60_000);
      }
    }
    await new Promise((r) => setTimeout(r, nextBoard || task ? 350 : 3000));
  }
}
