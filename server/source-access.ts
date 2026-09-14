import { origin } from "./source.js";
import { sourceSession } from "./source-session.js";

export async function catalogAccessible(cookie?: string, board = "hc") {
  const r = await fetch(`${origin}/${board}/catalog.json`, {
    headers: {
      Accept: "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) {
    await r.body?.cancel();
    return false;
  }
  const data = await r.json();
  return Array.isArray(data.threads) && data.threads.length > 0;
}
export type AccessStatus = "ready" | "needs-help" | "source-unavailable";
let checkedAt = 0;
let status: AccessStatus = "source-unavailable";
let pending: Promise<AccessStatus> | undefined;
export function invalidateAccess() {
  checkedAt = 0;
}
export async function accessStatus(): Promise<AccessStatus> {
  if (Date.now() - checkedAt < 60_000) return status;
  if (pending) return pending;
  pending = (async () => {
    try {
      const session = await sourceSession();
      if (await catalogAccessible(session.headers.Cookie)) status = "ready";
      else
        status = (await catalogAccessible(undefined, "b"))
          ? "needs-help"
          : "source-unavailable";
    } catch {
      status = "source-unavailable";
    }
    checkedAt = Date.now();
    return status;
  })().finally(() => {
    pending = undefined;
  });
  return pending;
}
