import { matchesDuration } from "../shared/duration.js";
import type { Board, Clip, Source, Topic } from "../shared/model.js";
export type Entry = {
  topic: Topic;
  clips: Clip[];
  checkedAt: number;
  stale?: boolean;
  discoveredAt?: number;
  error?: string;
};
export type BoardEntry = { at: number; topics: Record<string, Entry> };
export type LibraryData = Record<string, BoardEntry>;
const stamp = (t: Topic) => `${t.posts}:${t.files}:${t.updated}`;
export class VideoLibrary {
  data: LibraryData = {};
  catalog(board: string, topics: Topic[], clips: Clip[], now = Date.now()) {
    const previous = this.data[board]?.topics || {};
    const byThread = new Map<string, Clip[]>();
    for (const c of clips)
      byThread.set(c.thread, [...(byThread.get(c.thread) || []), c]);
    this.data[board] = {
      at: now,
      topics: Object.fromEntries(
        topics.map((topic) => {
          const old = previous[topic.id];
          const unchanged = old && stamp(old.topic) === stamp(topic);
          return [
            topic.id,
            {
              topic,
              clips:
                (unchanged && old.checkedAt) || old?.clips.length
                  ? old.clips
                  : byThread.get(topic.id) || [],
              checkedAt: old?.checkedAt || 0,
              stale: !unchanged || !!old?.stale,
              discoveredAt: old?.discoveredAt || now,
              error: old?.error,
            },
          ];
        }),
      ),
    };
  }
  thread(board: string, id: string, clips: Clip[], now = Date.now()) {
    const parent = (this.data[board] ||= { at: 0, topics: {} });
    const previous = parent.topics[id];
    const topic = previous?.topic || {
      id,
      board,
      title: clips[0]?.title || `Тред №${id}`,
      posts: 0,
      files: 0,
      opVideos: 0,
      updated: 0,
    };
    parent.topics[id] = {
      topic,
      clips: [...new Map(clips.map((c) => [c.id, c])).values()],
      checkedAt: now,
      stale: false,
      discoveredAt: previous?.discoveredAt || now,
    };
  }
  failure(board: string, id: string, message: string) {
    const entry = this.data[board]?.topics[id];
    if (entry) entry.error = message;
  }
  topics(board: string, minimum = 0): Topic[] {
    return Object.values(this.data[board]?.topics || {}).map((e) => {
      const clips = e.clips.filter((c) =>
        matchesDuration(c, minimum > 0, minimum),
      );
      return {
        ...e.topic,
        indexState: e.error
          ? "error"
          : e.checkedAt && !e.stale
            ? "complete"
            : "pending",
        videoCount: clips.length,
        videoState: clips.length
          ? "ready"
          : e.error
            ? "error"
            : e.checkedAt && !e.stale
              ? "empty"
              : "unknown",
        samples: clips.slice(0, 2),
      };
    });
  }
  board(board: Board, minimum = 0): Board {
    const topics = this.topics(board.id, minimum);
    const clips = topics.flatMap((t) => t.samples || []);
    const count = topics.reduce((n, t) => n + (t.videoCount || 0), 0);
    return {
      ...board,
      indexState: topics.some((t) => t.indexState === "error")
        ? "error"
        : this.data[board.id]?.at &&
            topics.every((t) => t.indexState === "complete")
          ? "complete"
          : "pending",
      videoCount: count,
      videoState: count
        ? "ready"
        : this.data[board.id]?.at &&
            topics.every((t) => t.videoState === "empty")
          ? "empty"
          : "unknown",
      samples: clips.slice(0, 12),
    };
  }
  clips(sources: Source[], registry: Board[], includeAdult: boolean): Clip[] {
    const eligible = registry.filter((b) => includeAdult || !b.adult);
    const result: Clip[] = [];
    for (const b of eligible) {
      const broad = sources.some(
        (s) =>
          s.kind === "root" ||
          (s.kind === "category" && s.id === b.category) ||
          (s.kind === "board" && s.id === b.id),
      );
      for (const e of Object.values(this.data[b.id]?.topics || {}))
        if (
          broad ||
          sources.some(
            (s) =>
              s.kind === "thread" && s.board === b.id && s.id === e.topic.id,
          )
        )
          result.push(...e.clips);
    }
    return [...new Map(result.map((c) => [c.id, c])).values()];
  }
}
