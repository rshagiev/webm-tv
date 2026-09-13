import { randomUUID } from "node:crypto";
import {
  library,
  libraryReady,
  rememberCatalog,
  rememberThread,
} from "./library.js";
import { boards, catalog, thread } from "./source.js";
import {
  normalizeSources,
  type Source,
  type Feed,
  type Clip,
} from "../shared/model.js";
export type Job = Feed & { touch: number; stopped: boolean; seen: Set<string> };
export const jobs = new Map<string, Job>();
export function addClips(job: Job, clips: Clip[]) {
  const seen = job.seen;
  for (const c of clips)
    if (!seen.has(c.id)) {
      seen.add(c.id);
      job.clips.push(c);
    }
  job.progress.updated = Date.now();
}
function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
export function createFeed(sources: Source[], includeAdult: boolean): Job {
  // Jobs are leased by polling. A closed tab cannot keep crawling the site.
  for (const [id, j] of jobs) {
    if (Date.now() - j.touch > 60_000) {
      j.stopped = true;
      jobs.delete(id);
    }
  }
  if (jobs.size >= 4) throw new Error("Слишком много открытых эфиров");
  const job: Job = {
    id: randomUUID(),
    clips: [],
    seen: new Set(),
    issues: [],
    touch: Date.now(),
    stopped: false,
    progress: {
      boardsDone: 0,
      boardsTotal: 0,
      threadsDone: 0,
      threadsTotal: 0,
      errors: 0,
      done: false,
      cancelled: false,
      updated: Date.now(),
    },
  };
  jobs.set(job.id, job);
  void run(job, sources, includeAdult);
  return job;
}
async function run(job: Job, sources: Source[], includeAdult: boolean) {
  const stopped = () => job.stopped || Date.now() - job.touch > 20_000;
  const issue = (label: string, e: unknown) => {
    job.progress.errors++;
    if (job.issues.length < 20)
      job.issues.push(
        `${label}: ${e instanceof Error ? e.message : "ошибка источника"}`,
      );
  };
  try {
    await libraryReady;
    const registry = await boards();
    addClips(job, library.clips(sources, registry, includeAdult));
    const normalized = normalizeSources(sources, registry);
    const eligible = registry.filter((b) => includeAdult || !b.adult);
    const whole = shuffle(
      eligible.filter(
        (b) =>
          b.video &&
          normalized.some(
            (s) =>
              s.kind === "root" ||
              (s.kind === "category" && s.id === b.category) ||
              (s.kind === "board" && s.id === b.id),
          ),
      ),
    );
    job.progress.boardsTotal = whole.length;
    const queues: { board: string; ids: string[] }[] = [];
    for (const s of normalized.filter((s) => s.kind === "thread"))
      if (eligible.some((b) => b.id === s.board))
        queues.push({ board: s.board!, ids: [s.id] });
    // Catalog OP clips let broad channels start before full discovery completes.
    for (let i = 0; i < whole.length && !stopped(); i += 3) {
      await Promise.all(
        whole.slice(i, i + 3).map(async (b) => {
          try {
            const c = await catalog(b.id);
            rememberCatalog(b.id, c);
            if (!stopped()) {
              addClips(job, c.clips);
              queues.push({
                board: b.id,
                ids: shuffle(c.topics.map((t) => t.id)),
              });
              job.progress.threadsTotal += c.topics.length;
            }
          } catch (e) {
            issue("/" + b.id + "/", e);
          } finally {
            job.progress.boardsDone++;
          }
        }),
      );
    }
    job.progress.threadsTotal = queues.reduce((n, q) => n + q.ids.length, 0);
    // Round-robin across boards; no topic keyword classification or hidden cutoff.
    const tasks: { board: string; id: string }[] = [];
    let more = true;
    while (more) {
      more = false;
      for (const q of queues) {
        const id = q.ids.pop();
        if (id) {
          more = true;
          tasks.push({ board: q.board, id });
        }
      }
    }
    let cursor = 0;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (cursor < tasks.length && !stopped()) {
          const task = tasks[cursor++];
          try {
            const clips = await thread(task.board, task.id);
            rememberThread(task.board, task.id, clips);
            if (!stopped()) addClips(job, clips);
          } catch (e) {
            issue(`/${task.board}/${task.id}`, e);
          } finally {
            job.progress.threadsDone++;
            job.progress.updated = Date.now();
          }
        }
      }),
    );
    job.progress.cancelled = stopped();
  } catch (e) {
    issue("Эфир", e);
  } finally {
    job.progress.done = true;
    job.progress.updated = Date.now();
  }
}
