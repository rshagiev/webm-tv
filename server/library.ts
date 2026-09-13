import { resolve } from "node:path";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { boards, catalog, thread } from "./source.js";
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
  running = false,
  round = 0;
const priority = new Set<string>();
const retryAfter = new Map<string, number>();
export function warmLibrary(board?: string) {
  touched = Date.now();
  if (board) priority.add(board);
  if (!running) {
    running = true;
    void warm().finally(() => {
      running = false;
    });
  }
}
async function warm() {
  await libraryReady;
  let registry: Board[] = [];
  try {
    registry = (await boards()).filter((b) => b.video);
  } catch {
    return;
  }
  while (
    Date.now() - touched <
    (process.env.PUBLIC_ORIGIN ? 180_000 : 25_000)
  ) {
    const now = Date.now();
    const nextBoard = registry.find(
      (b) =>
        (!library.data[b.id]?.at || now - library.data[b.id].at > 600_000) &&
        (retryAfter.get(b.id) || 0) < now,
    );
    if (nextBoard) {
      try {
        rememberCatalog(nextBoard.id, await catalog(nextBoard.id));
      } catch {
        retryAfter.set(nextBoard.id, now + 60_000);
      }
    }
    const ordered = [
      ...registry.filter((b) => priority.has(b.id)),
      ...registry.slice(round),
      ...registry.slice(0, round),
    ];
    let found = false;
    for (const b of ordered) {
      const entries = Object.values(library.data[b.id]?.topics || {})
        .filter(
          (e) =>
            (!e.checkedAt || now - e.checkedAt > 900_000) &&
            (retryAfter.get(b.id + ":" + e.topic.id) || 0) < now,
        )
        .sort(
          (a, b) =>
            Number(!!a.checkedAt) - Number(!!b.checkedAt) ||
            b.topic.opVideos - a.topic.opVideos,
        );
      const e = entries[0];
      if (!e) {
        priority.delete(b.id);
        continue;
      }
      try {
        rememberThread(b.id, e.topic.id, await thread(b.id, e.topic.id));
      } catch (error) {
        library.failure(b.id, e.topic.id, (error as Error).message);
        retryAfter.set(b.id + ":" + e.topic.id, now + 60_000);
      }
      round = (registry.findIndex((x) => x.id === b.id) + 1) % registry.length;
      found = true;
      break;
    }
    await new Promise((r) => setTimeout(r, nextBoard || found ? 350 : 3000));
  }
}
