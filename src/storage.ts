import { useEffect, useState } from "react";
export function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem("webmtv:" + key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
export function save(key: string, value: unknown) {
  try {
    localStorage.setItem("webmtv:" + key, JSON.stringify(value));
  } catch {}
}
export function useStored<T>(key: string, fallback: T) {
  const [value, set] = useState<T>(() => read(key, fallback));
  useEffect(() => save(key, value), [key, value]);
  return [value, set] as const;
}
