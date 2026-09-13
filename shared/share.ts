import type { Clip } from "./model";
export function validClipAddress(board: string, thread: string, file: string) {
  return (
    /^[a-z0-9_-]{1,32}$/.test(board) &&
    /^\d{1,20}$/.test(thread) &&
    /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,180}\.(mp4|webm)$/.test(file)
  );
}
export function clipPath(clip: Clip) {
  const file = new URL(clip.url).pathname.split("/").pop()!;
  if (!validClipAddress(clip.board, clip.thread, file))
    throw new Error("Некорректная ссылка на ролик");
  return `/watch/${clip.board}/${clip.thread}/${file}`;
}
export function sharedClipApi(path: string) {
  const parts = path.split("/");
  if (
    parts.length !== 5 ||
    parts[1] !== "watch" ||
    !validClipAddress(parts[2], parts[3], parts[4])
  )
    return null;
  return `/clips/${parts[2]}/${parts[3]}/${parts[4]}`;
}
