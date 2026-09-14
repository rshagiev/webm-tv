import type { Clip } from "../shared/model";
export type PlaybackHistory = { history: Clip[]; position: number };
import { filterHistory } from "./thread-exclusions";
export type HistoryAction =
  | { type: "filter"; allowed: (c: Clip) => boolean }
  | { type: "append"; clip: Clip }
  | { type: "reset"; clip?: Clip }
  | { type: "move"; position: number };
export const emptyHistory: PlaybackHistory = { history: [], position: -1 };
export function playbackHistory(
  state: PlaybackHistory,
  action: HistoryAction,
): PlaybackHistory {
  if (action.type === "filter") return filterHistory(state, action.allowed);
  if (action.type === "reset")
    return action.clip ? { history: [action.clip], position: 0 } : emptyHistory;
  if (action.type === "move")
    return {
      ...state,
      position: state.history.length
        ? Math.max(0, Math.min(state.history.length - 1, action.position))
        : -1,
    };
  const history = [
    ...state.history.slice(0, state.position + 1),
    action.clip,
  ].slice(-200);
  return { history, position: history.length - 1 };
}
