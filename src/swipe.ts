export function swipeRelease(
  dx: number,
  dy: number,
  elapsed: number,
  height: number,
): "next" | "previous" | null {
  if (Math.abs(dy) < Math.abs(dx) * 1.2) return null;
  const distance = Math.abs(dy);
  const committed = distance >= Math.min(180, height * 0.22);
  const flick = distance >= 45 && distance / Math.max(1, elapsed) >= 0.45;
  return committed || flick ? (dy < 0 ? "next" : "previous") : null;
}
