import type { Board, Clip, Source } from "../shared/model";
import { RADIO_POOL_LIMIT } from "../shared/radio";

/** Retain candidates from every selected branch, not just the last response. */
export function mergeRadioPool(
  old: Clip[],
  incoming: Clip[],
  sources: Source[],
  boards: Board[],
): Clip[] {
  const all = [
    ...new Map([...old, ...incoming].map((c) => [c.id, c])).values(),
  ];
  const categories = new Map(boards.map((b) => [b.id, b.category]));
  const quota = Math.max(1, Math.floor(RADIO_POOL_LIMIT / sources.length));
  const selected = sources.flatMap((s) =>
    all
      .filter(
        (c) =>
          s.kind === "root" ||
          (s.kind === "category" && categories.get(c.board) === s.id) ||
          (s.kind === "board" && c.board === s.id) ||
          (s.kind === "thread" && c.board === s.board && c.thread === s.id),
      )
      .slice(-quota),
  );
  return [...new Map(selected.map((c) => [c.id, c])).values()].slice(
    -RADIO_POOL_LIMIT,
  );
}
export class RefillCursor {
  bucket: number;
  initialized = false;
  private requests = 0;
  readyAt = 0;
  constructor(random = Math.random) {
    this.bucket = Math.floor(random() * 8);
  }
  accept(complete: boolean, now: number, cooldown = 60_000) {
    this.initialized = true;
    this.bucket = (this.bucket + 1) % 8;
    this.requests++;
    if (complete || this.requests >= 8) {
      this.readyAt = now + cooldown;
      this.requests = 0;
    }
  }
}
