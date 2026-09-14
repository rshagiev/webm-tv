import type { Board } from "../shared/model.js";
import type { Entry, LibraryData } from "./library-state.js";
export const catalogInterval = (b: Board) =>
  (b.activity || 0) >= 100 ? 60_000 : 300_000;
export const needsRead = (e: Entry, now: number) =>
  !e.checkedAt || now - e.checkedAt >= (e.stale ? 60_000 : 900_000);
export class CrawlQueue {
  private requests = new Map<
    string,
    { board: string; thread?: string; until: number }
  >();
  private credits = new Map<string, number>();
  private revisit = new Map<string, boolean>();
  private urgentRun = 0;
  request(board: string, thread: string | undefined, now: number) {
    const key = board + ":" + (thread || "");
    // A stream of viewers extends a shared request; it does not add jobs.
    this.requests.set(key, { board, thread, until: now + 120_000 });
    while (this.requests.size > 128)
      this.requests.delete(this.requests.keys().next().value!);
  }
  pick(
    data: LibraryData,
    boards: Board[],
    retry: Map<string, number>,
    now: number,
  ) {
    const allowed = new Set(boards.map((b) => b.id));
    for (const [k, r] of this.requests)
      if (r.until <= now || !allowed.has(r.board)) this.requests.delete(k);
    for (const k of this.credits.keys())
      if (!allowed.has(k)) {
        this.credits.delete(k);
        this.revisit.delete(k);
      }
    const candidates = (board: string) =>
      Object.values(data[board]?.topics || {}).filter(
        (e) =>
          needsRead(e, now) &&
          (retry.get(board + ":" + e.topic.id) || 0) <= now,
      );
    const select = (board: string, entries: Entry[]) => {
      const fresh = entries
        .filter((e) => !e.checkedAt)
        .sort(
          (a, b) =>
            (a.discoveredAt || 0) - (b.discoveredAt || 0) ||
            a.topic.updated - b.topic.updated ||
            a.topic.id.localeCompare(b.topic.id),
        );
      const old = entries
        .filter((e) => !!e.checkedAt)
        .sort(
          (a, b) =>
            a.checkedAt - b.checkedAt || a.topic.id.localeCompare(b.topic.id),
        );
      const chosen = this.revisit.get(board)
        ? old[0] || fresh[0]
        : fresh[0] || old[0];
      if (chosen) this.revisit.set(board, !this.revisit.get(board));
      return chosen;
    };
    if (this.urgentRun < 2) {
      // Exact thread requests precede broad board requests.
      const requests = [...this.requests.entries()].sort(
        (a, b) => Number(!!b[1].thread) - Number(!!a[1].thread),
      );
      for (const [key, r] of requests) {
        const entry = r.thread
          ? data[r.board]?.topics[r.thread]
          : select(r.board, candidates(r.board));
        if (
          r.thread &&
          entry &&
          entry.checkedAt &&
          now - entry.checkedAt < 60_000
        ) {
          this.requests.delete(key);
          continue;
        }
        if (!entry || (retry.get(r.board + ":" + entry.topic.id) || 0) > now)
          continue;
        this.requests.delete(key);
        this.urgentRun++;
        return { board: r.board, entry };
      }
    }
    this.urgentRun = 0;
    const eligible = boards
      .map((b) => ({ b, entries: candidates(b.id) }))
      .filter((x) => x.entries.length);
    let total = 0,
      winner: (typeof eligible)[number] | undefined,
      score = -Infinity;
    for (const x of eligible) {
      const weight =
        1 + Math.min(4, Math.floor(Math.log10(1 + (x.b.activity || 0))));
      total += weight;
      const credit = (this.credits.get(x.b.id) || 0) + weight;
      this.credits.set(x.b.id, credit);
      if (credit > score) {
        score = credit;
        winner = x;
      }
    }
    // Idle boards must not accumulate credit or pay off obsolete debt.
    const busy = new Set(eligible.map((x) => x.b.id));
    for (const id of this.credits.keys())
      if (!busy.has(id)) this.credits.delete(id);
    if (!winner) return;
    this.credits.set(winner.b.id, score - total);
    return { board: winner.b.id, entry: select(winner.b.id, winner.entries)! };
  }
}
