import type { Clip, Source } from "../shared/model";
import type { PlaybackHistory } from "./playback-history";
import { playbackUrl } from "../shared/media";
export const RELOAD_KEY = "webmtv-reload-v1";
export const RELOAD_TTL = 5 * 60_000;
export type ReloadSession = PlaybackHistory & {
  at: number;
  path: string;
  selection: Source;
  sources: Source[];
  time: number;
  playing: boolean;
};
const source = (s: any): s is Source =>
  s &&
  ["root", "category", "board", "thread"].includes(s.kind) &&
  typeof s.id === "string" &&
  typeof s.label === "string" &&
  (s.kind !== "thread" || typeof s.board === "string");
const clip = (c: any): c is Clip =>
  c &&
  ["id", "url", "board", "thread", "post", "title"].every(
    (k) => typeof c[k] === "string",
  ) &&
  ["duration", "width", "height"].every((k) => Number.isFinite(c[k])) &&
  playbackUrl(c.url).startsWith("/api/media/");
export function decodeReload(
  raw: string | null,
  path: string,
  now = Date.now(),
): ReloadSession | undefined {
  try {
    if (!raw || raw.length > 500_000) return;
    const s = JSON.parse(raw);
    if (
      s.path !== path ||
      !Number.isFinite(s.at) ||
      now < s.at ||
      now - s.at > RELOAD_TTL ||
      !Number.isFinite(s.time) ||
      s.time < 0 ||
      typeof s.playing !== "boolean" ||
      !source(s.selection) ||
      !Array.isArray(s.sources) ||
      !s.sources.length ||
      s.sources.length > 128 ||
      !s.sources.every(source) ||
      !Array.isArray(s.history) ||
      !s.history.length ||
      s.history.length > 200 ||
      !s.history.every(clip) ||
      !Number.isInteger(s.position) ||
      s.position < 0 ||
      s.position >= s.history.length
    )
      return;
    return s;
  } catch {
    return;
  }
}
export function takeReload() {
  try {
    const raw = sessionStorage.getItem(RELOAD_KEY);
    sessionStorage.removeItem(RELOAD_KEY);
    return decodeReload(raw, location.pathname);
  } catch {
    return;
  }
}
