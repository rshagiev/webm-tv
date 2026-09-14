import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

export function sourceSessionFile() {
  return (
    process.env.SOURCE_USERCODE_FILE ||
    resolve(process.env.WEBMTV_DATA_DIR || "data", "source-usercode.txt")
  );
}
export async function saveSourceSession(value: string) {
  if (
    !value ||
    value.length > 4096 ||
    !/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/.test(value)
  )
    throw new Error("Некорректная сессия источника");
  const file = sourceSessionFile();
  await mkdir(resolve(file, ".."), { recursive: true });
  await writeFile(file + ".new", value + "\n", { mode: 0o600 });
  await rename(file + ".new", file);
}
// Read on each request so replacing the file does not require a restart.
export async function sourceSession() {
  const explicit = process.env.SOURCE_USERCODE_FILE;
  const file =
    explicit ||
    resolve(process.env.WEBMTV_DATA_DIR || "data", "source-usercode.txt");
  let value: string;
  try {
    value = (await readFile(file, "utf8")).trim();
  } catch (error) {
    if (!explicit && (error as NodeJS.ErrnoException).code === "ENOENT")
      return { headers: {} as Record<string, string>, cacheScope: "anonymous" };
    throw new Error("Не удалось прочитать файл сессии Двача");
  }
  if (
    !value ||
    value.length > 4096 ||
    value.startsWith("usercode_auth=") ||
    !/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/.test(value)
  )
    throw new Error(
      "Файл сессии Двача должен содержать только значение usercode_auth",
    );
  return {
    headers: { Cookie: `usercode_auth=${value}` },
    cacheScope: createHash("sha256").update(value).digest("hex"),
  };
}
