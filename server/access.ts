import { networkInterfaces } from "node:os";
export function localHosts() {
  return new Set([
    "localhost",
    "127.0.0.1",
    ...Object.values(networkInterfaces()).flatMap((xs) =>
      (xs || []).filter((x) => x.family === "IPv4").map((x) => x.address),
    ),
  ]);
}
export function permitted(host: string, origin?: string) {
  try {
    const target = new URL("http://" + host);
    if (
      !localHosts().has(target.hostname) ||
      !["4173", "5173"].includes(target.port)
    )
      return false;
    if (!origin) return true;
    const from = new URL(origin);
    return (
      from.protocol === "http:" &&
      from.hostname === target.hostname &&
      ["4173", "5173"].includes(from.port)
    );
  } catch {
    return false;
  }
}
