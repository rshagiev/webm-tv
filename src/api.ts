export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch("/api" + path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Не удалось загрузить");
  return data;
}
