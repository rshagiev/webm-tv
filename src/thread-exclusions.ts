import type { Clip } from "../shared/model";
import type { PlaybackHistory } from "./playback-history";
export type ThreadExclusion = { board: string; thread: string; title: string };
export const threadKey = (t: { board: string; thread: string }) =>
  `${t.board}:${t.thread}`;
export const threadAllowed = (c: Clip, excluded: ThreadExclusion[]) =>
  !excluded.some((t) => threadKey(t) === threadKey(c));
export function filterHistory(
  state: PlaybackHistory,
  allowed: (c: Clip) => boolean,
): PlaybackHistory {
  const current = state.history[state.position];
  if (!current || !allowed(current)) return { history: [], position: -1 };
  return {
    history: state.history.filter(allowed),
    position: state.history.slice(0, state.position).filter(allowed).length,
  };
}
