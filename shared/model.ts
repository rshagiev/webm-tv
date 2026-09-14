export type VideoAvailability = {
  indexState?: "pending" | "complete" | "error";
  videoCount?: number;
  videoState?: "ready" | "empty" | "unknown" | "error";
  samples?: Clip[];
};
export type Board = VideoAvailability & {
  id: string;
  name: string;
  category: string;
  adult: boolean;
  threads: number;
  activity?: number;
  video: boolean;
};
export type Topic = VideoAvailability & {
  id: string;
  board: string;
  title: string;
  posts: number;
  files: number;
  opVideos: number;
  updated: number;
};
export type Source = {
  kind: "root" | "category" | "board" | "thread";
  id: string;
  board?: string;
  label: string;
};
export type Clip = {
  id: string;
  url: string;
  duration: number;
  board: string;
  thread: string;
  post: string;
  title: string;
  width: number;
  height: number;
};
export type Progress = {
  boardsDone: number;
  boardsTotal: number;
  threadsDone: number;
  threadsTotal: number;
  errors: number;
  done: boolean;
  cancelled: boolean;
  updated: number;
};
export type Feed = {
  id: string;
  clips: Clip[];
  progress: Progress;
  issues: string[];
};
export type Collection = { id: string; name: string; sources: Source[] };
export const sourceKey = (s: Source) => `${s.kind}:${s.board || ""}:${s.id}`;
export function covers(a: Source, b: Source, boards: Board[]): boolean {
  if (sourceKey(a) === sourceKey(b) || a.kind === "root") return true;
  const board = b.kind === "board" ? b.id : b.board;
  if (a.kind === "board") return b.kind === "thread" && board === a.id;
  if (a.kind === "category")
    return !!board && boards.some((x) => x.id === board && x.category === a.id);
  return false;
}
export function normalizeSources(sources: Source[], boards: Board[]): Source[] {
  const unique = [...new Map(sources.map((s) => [sourceKey(s), s])).values()];
  return unique.filter(
    (s) => !unique.some((other) => other !== s && covers(other, s, boards)),
  );
}
