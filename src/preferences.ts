import type { Clip } from "../shared/model";
export type Reason = "skip" | "ended" | "leave" | "error" | "save" | "hide";
export type Observation = {
  clip: Clip;
  watched: number;
  duration: number;
  reason: Reason;
};
export type Interest = {
  sum: number;
  count: number;
  at: number;
  label: string;
};
export type Profile = Record<string, Interest>;
const decay = (at: number, now: number) =>
  2 ** (-Math.max(0, now - at) / (14 * 86400000));
export function reward(o: Observation): number | null {
  if (o.reason === "save") return 1;
  if (o.reason === "hide") return -1;
  if (
    o.reason === "error" ||
    o.reason === "leave" ||
    !Number.isFinite(o.duration) ||
    o.duration <= 0 ||
    o.watched < 0.5
  )
    return null;
  const fraction = Math.min(1, o.watched / o.duration);
  if (o.reason === "skip" && o.watched < 3 && fraction < 0.25) return -0.4;
  if (fraction >= 0.8) return 0.8;
  if (o.watched >= 15 && fraction >= 0.35) return 0.4;
  return 0;
}
export function learn(
  profile: Profile,
  o: Observation,
  now = Date.now(),
): Profile {
  const value = reward(o);
  if (value === null) return profile;
  const next = { ...profile };
  for (const [key, strength] of [
    [o.clip.board + ":" + o.clip.thread, 1],
    [o.clip.board, 0.25],
  ] as const) {
    const old = next[key];
    const d = old ? decay(old.at, now) : 0;
    next[key] = {
      sum: (old?.sum || 0) * d + value * strength,
      count: (old?.count || 0) * d + strength,
      at: now,
      label: key.includes(":") ? o.clip.title : "/" + o.clip.board + "/",
    };
  }
  return Object.fromEntries(
    Object.entries(next)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 1500),
  );
}
export function interestWeight(profile: Profile, clip: Clip, now = Date.now()) {
  const score = (key: string) => {
    const x = profile[key];
    if (!x) return 0;
    const d = decay(x.at, now);
    return (x.sum * d) / (3 + x.count * d);
  };
  return Math.exp(
    2 * score(clip.board + ":" + clip.thread) + 0.5 * score(clip.board),
  );
}
// Ignore jumps, suspended timers, seeks and non-visible/non-playing time.
export function watchDelta(
  mediaDelta: number,
  wallDelta: number,
  active: boolean,
) {
  return active &&
    wallDelta > 0 &&
    wallDelta <= 2 &&
    mediaDelta > 0 &&
    mediaDelta <= wallDelta * 1.5 + 0.2
    ? Math.min(mediaDelta, wallDelta)
    : 0;
}
