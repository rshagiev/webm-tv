import type { Board, Clip, Source } from "../shared/model.js";
import type { VideoLibrary } from "./library-state.js";
import { matchesDuration } from "../shared/duration.js";

export const publicOrigin = process.env.PUBLIC_ORIGIN || "";
if (
  publicOrigin &&
  (new URL(publicOrigin).origin !== publicOrigin ||
    !publicOrigin.startsWith("https://"))
)
  throw new Error(
    "PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash",
  );
export function publicAccess(host: string, origin?: string) {
  return (
    (host === new URL(publicOrigin).host &&
      (!origin || origin === publicOrigin)) ||
    (host === "127.0.0.1:4173" && !origin)
  );
}
export function validSources(value: unknown): value is Source[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 32 &&
    value.every(
      (s) =>
        s &&
        ["root", "category", "board", "thread"].includes(s.kind) &&
        typeof s.id === "string" &&
        s.id.length <= 100 &&
        typeof s.label === "string" &&
        s.label.length <= 200 &&
        (s.kind !== "thread" ||
          (/^[a-z0-9_]+$/.test(s.board || "") && /^\d+$/.test(s.id))),
    )
  );
}
// Expensive catalogue work is shared and bounded; clients never launch crawlers.
export class PublicCache {
  private values = new Map<string, { until: number; value: unknown }>();
  get<T>(key: string, create: () => T, now = Date.now()): T {
    const old = this.values.get(key);
    if (old && old.until > now) return old.value as T;
    if (this.values.size >= 32)
      this.values.delete(this.values.keys().next().value!);
    const value = create();
    this.values.set(key, { until: now + 30_000, value });
    return value;
  }
}
export function sampleRadio(
  library: VideoLibrary,
  registry: Board[],
  sources: Source[],
  adult: boolean,
  minimum: number,
  exclude: Set<string>,
  random = Math.random,
): Clip[] {
  const entries: Clip[][] = [];
  for (const b of registry) {
    if (b.adult && !adult) continue;
    const broad = sources.some(
      (s) =>
        s.kind === "root" ||
        (s.kind === "category" && s.id === b.category) ||
        (s.kind === "board" && s.id === b.id),
    );
    for (const e of Object.values(library.data[b.id]?.topics || {})) {
      if (
        !broad &&
        !sources.some(
          (s) => s.kind === "thread" && s.board === b.id && s.id === e.topic.id,
        )
      )
        continue;
      if (e.clips.length) entries.push(e.clips);
    }
  }
  const result = new Map<string, Clip>();
  // Reservoir sampling provides a bounded response even for a single huge thread.
  // Threads are shuffled first so large threads do not always dominate the batch.
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  for (let pass = 0; pass < 96 && result.size < 96; pass++) {
    let added = false;
    for (const clips of entries) {
      const start = Math.floor(random() * clips.length);
      for (let i = 0; i < clips.length; i++) {
        const c = clips[(start + i) % clips.length];
        if (
          !exclude.has(c.id) &&
          !result.has(c.id) &&
          matchesDuration(c, minimum > 0, minimum)
        ) {
          result.set(c.id, c);
          added = true;
          break;
        }
      }
      if (result.size >= 96) break;
    }
    if (!added) break;
  }
  return [...result.values()];
}
