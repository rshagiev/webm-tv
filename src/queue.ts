import type { Clip } from "../shared/model";
export function chooseClip(
  clips: Clip[],
  seen: Set<string>,
  hidden: Set<string>,
  current?: Clip,
  weight?: (clip: Clip) => number,
): Clip | undefined {
  const available = clips.filter((c) => !seen.has(c.id) && !hidden.has(c.id));
  const threads = new Map<string, Clip[]>();
  for (const c of available) {
    const key = c.board + ":" + c.thread;
    const group = threads.get(key) || [];
    group.push(c);
    threads.set(key, group);
  }
  let keys = [...threads.keys()];
  const previous = current ? current.board + ":" + current.thread : "";
  if (keys.length > 1) keys = keys.filter((k) => k !== previous);
  let selected = keys[Math.floor(Math.random() * keys.length)];
  if (weight && Math.random() >= 0.3) {
    const weights = keys.map((k) => weight(threads.get(k)![0]));
    let draw = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < keys.length; i++) {
      draw -= weights[i];
      if (draw <= 0) {
        selected = keys[i];
        break;
      }
    }
  }
  const group = threads.get(selected);
  return group?.[Math.floor(Math.random() * group.length)];
}
export function ignoreHotkey(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    !!target.closest(
      'input,textarea,select,video,[contenteditable="true"],[role="slider"],[role="dialog"]',
    )
  );
}
export function swipeDirection(
  dx: number,
  dy: number,
  elapsed: number,
): "next" | "previous" | null {
  if (elapsed > 1000 || Math.abs(dy) < 55 || Math.abs(dy) < Math.abs(dx) * 1.3)
    return null;
  return dy < 0 ? "next" : "previous";
}
