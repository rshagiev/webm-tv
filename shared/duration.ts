import type { Clip } from "./model";
export function matchesDuration(
  clip: Clip,
  onlyLong: boolean,
  minimum: number,
) {
  return (
    !onlyLong || (Number.isFinite(clip.duration) && clip.duration >= minimum)
  );
}
