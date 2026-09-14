const sourcePath = /^\/[a-z0-9_]+\/src\/\d+\/[a-zA-Z0-9_-]+\.(?:mp4|webm)$/i;
export function validMediaPath(path: string) {
  return sourcePath.test(path);
}
export function playbackUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol === "https:" &&
      ["2ch.hk", "2ch.su"].includes(parsed.host) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      validMediaPath(parsed.pathname)
    )
      return "/api/media" + parsed.pathname;
  } catch {}
  return url;
}
