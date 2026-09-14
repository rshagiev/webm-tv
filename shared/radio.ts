import type { Source, Clip } from "./model.js";
export const RADIO_BUCKETS = 8;
export const RADIO_BATCH_SIZE = 96;
export const RADIO_LOW_WATER = 24;
export const RADIO_POOL_LIMIT = 400;
export const PUBLIC_MINIMUMS = [0, 60, 180, 300, 600];
export type RadioBatch = {
  clips: Clip[];
  complete: boolean;
  pending?: boolean;
};
export function radioPath(
  source: Source,
  bucket: number,
  adult: boolean,
  minimum: number,
) {
  const id =
    source.kind === "thread"
      ? `${source.board}.${source.id}`
      : source.kind === "root"
        ? "all"
        : source.id;
  return `/radio/${source.kind}/${encodeURIComponent(id)}/${bucket}?adult=${adult ? 1 : 0}&minimum=${minimum}`;
}
