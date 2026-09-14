// Daily browser identity; never transmit clip URLs, preferences, or playback history.
export function startAudience() {
  let identity = "";
  let identityDay = "";
  let seconds = 0;
  let lastSample = performance.now();
  const positions = new WeakMap<HTMLVideoElement, number>();
  function id() {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== identityDay) {
      identityDay = day;
      identity = Array.from(
        crypto.getRandomValues(new Uint8Array(18)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      try {
        const saved = JSON.parse(
          localStorage.getItem("webmtv:audience") || "null",
        );
        if (saved?.day === day && /^[a-f0-9-]{36}$/.test(saved.id))
          identity = saved.id;
        else
          localStorage.setItem(
            "webmtv:audience",
            JSON.stringify({ day, id: identity }),
          );
      } catch {
        /* Storage-disabled browsers retain only a tab identity. */
      }
    }
    return identity;
  }
  function sample() {
    const now = performance.now();
    const elapsed = Math.min(2, Math.max(0, (now - lastSample) / 1000));
    lastSample = now;
    let advancing = false;
    for (const video of document.querySelectorAll(".player video")) {
      const v = video as HTMLVideoElement;
      const previous = positions.get(v);
      if (
        !v.paused &&
        !v.ended &&
        v.readyState >= 2 &&
        previous !== undefined &&
        v.currentTime > previous
      )
        advancing = true;
      positions.set(v, v.currentTime);
    }
    if (document.visibilityState === "visible" && advancing)
      seconds = Math.min(30, seconds + elapsed);
  }
  function send() {
    sample();
    const visible = document.visibilityState === "visible";
    if (!visible && seconds === 0) return;
    const body = JSON.stringify({ id: id(), seconds, visible });
    seconds = 0;
    void fetch("/api/audience/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-WebMTV-Audience": "1" },
      body,
      keepalive: true,
    }).catch(() => {});
  }
  send();
  const sampler = setInterval(sample, 1000);
  const heartbeat = setInterval(send, 15_000);
  document.addEventListener("visibilitychange", send);
  window.addEventListener("pagehide", send);
  return () => {
    clearInterval(sampler);
    clearInterval(heartbeat);
    document.removeEventListener("visibilitychange", send);
    window.removeEventListener("pagehide", send);
  };
}
