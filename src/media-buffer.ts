/** Warm a neighbor only after playback starts and has a useful safety margin. */
export function canWarmNeighbor(
  media: {
    paused: boolean;
    readyState: number;
    currentTime: number;
    duration: number;
    buffered: Pick<TimeRanges, "length" | "start" | "end">;
  },
  visible: boolean,
  wanted: boolean,
): boolean {
  if (!visible || !wanted || media.paused || media.readyState < 3) return false;
  for (let i = 0; i < media.buffered.length; i++) {
    if (
      media.buffered.start(i) > media.currentTime ||
      media.buffered.end(i) <= media.currentTime
    )
      continue;
    const end = media.buffered.end(i);
    return (
      end - media.currentTime >= 4 ||
      (Number.isFinite(media.duration) && end >= media.duration - 0.1)
    );
  }
  return false;
}
