import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize,
  LoaderCircle,
  Radio,
} from "lucide-react";
import type { Clip } from "../shared/model";
import { useStored } from "./storage";
import { swipeRelease } from "./swipe";
import { canWarmNeighbor } from "./media-buffer";
import { playbackUrl } from "../shared/media";
import { watchDelta, type Observation, type Reason } from "./preferences";
export type PlayerHandle = {
  checkpoint: () => { url: string; time: number };
  start: (clip?: Clip) => void;
  hold: () => void;
  mute: () => void;
  fullscreen: () => void;
  feedback: (reason: Reason) => void;
};
type Props = {
  resume?: { url: string; time: number };
  clip?: Clip;
  preload?: Clip;
  previousClip?: Clip;
  wantPlay: boolean;
  stopAtEnd?: boolean;
  setWantPlay: (v: boolean) => void;
  next: () => void;
  previous: () => void;
  canPrevious: boolean;
  status: string;
  startLabel?: string;
  startHeading?: string;
  busy: boolean;
  onError: () => void;
  onPreloadError: (clip: Clip) => void;
  onPlaying: () => void;
  children?: ReactNode;
  onFeedback: (o: Observation) => void;
};
export const Player = forwardRef<PlayerHandle, Props>(function Player(
  {
    clip,
    resume,
    preload,
    previousClip,
    wantPlay,
    stopAtEnd = false,
    setWantPlay,
    next,
    previous,
    canPrevious,
    status,
    startLabel = "Смотреть",
    startHeading = "Двач на перемешке",
    busy,
    onError,
    onPreloadError,
    onPlaying,
    children,
    onFeedback,
  },
  ref,
) {
  const resumePending = useRef(resume);
  const video = useRef<HTMLVideoElement>(null),
    frame = useRef<HTMLDivElement>(null);
  const slots = useRef<(HTMLVideoElement | null)[]>([null, null, null]);
  const urls = useRef(["", "", ""]);
  const activeSlot = useRef(0);
  const [warmReady, setWarmReady] = useState(false);
  const updateWarmReady = () => {
    const v = video.current;
    setWarmReady(!!v && canWarmNeighbor(v, !document.hidden, wanted.current));
  };
  const [slotView, setSlotView] = useState({ active: 0, urls: ["", "", ""] });
  const observation = useRef<{
    clip?: Clip;
    watched: number;
    duration: number;
    reported: boolean;
  }>({ watched: 0, duration: 0, reported: false });
  const lastTick = useRef({ media: 0, wall: performance.now() });
  const feedbackHandler = useRef(onFeedback);
  feedbackHandler.current = onFeedback;
  const feedback = (reason: Reason) => {
    const o = observation.current;
    if (o.clip && !o.reported) {
      o.reported = true;
      feedbackHandler.current({
        clip: o.clip,
        watched: o.watched,
        duration: o.duration,
        reason,
      });
    }
  };
  const beginObservation = (c: Clip) => {
    observation.current = { clip: c, watched: 0, duration: 0, reported: false };
    lastTick.current = { media: 0, wall: performance.now() };
  };
  const loaded = useRef(""),
    generation = useRef(0),
    wanted = useRef(wantPlay);
  wanted.current = wantPlay;
  const [volume, setVolume] = useStored("volume", 0.65);
  const lastVolume = useRef(volume || 0.65);
  const [paused, setPaused] = useState(true),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [buffering, setBuffering] = useState(false),
    [blocked, setBlocked] = useState(false),
    [needsSound, setNeedsSound] = useState(false),
    [message, setMessage] = useState("");
  const handlers = useRef({ onError, setWantPlay });
  handlers.current = { onError, setWantPlay };
  const gesture = useRef<{
      x: number;
      y: number;
      at: number;
      height: number;
    } | null>(null),
    suppressClick = useRef(0);
  const [drag, setDrag] = useState(0);
  const [settling, setSettling] = useState(false);
  const [leaving, setLeaving] = useState<number | null>(null);
  const motionLock = useRef(false);
  const motionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const snapshot = useRef<HTMLCanvasElement>(null);
  const motionFrame = useRef(0);
  useEffect(
    () => () => {
      clearTimeout(motionTimer.current);
      cancelAnimationFrame(motionFrame.current);
    },
    [],
  );
  const settle = (
    direction: "next" | "previous" | null,
    offset: number,
    height: number,
  ) => {
    suppressClick.current = Date.now() + 250;
    motionLock.current = true;
    if (!direction) {
      setSettling(true);
      setDrag(0);
    } else {
      // Keep the departing frame while the buffered neighbor starts.
      const canvas = snapshot.current,
        v = video.current;
      if (canvas && v) {
        canvas.width = Math.round(frame.current?.clientWidth || 390);
        canvas.height = Math.round(height);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#080a0c";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          if (v.videoWidth && v.videoHeight) {
            const scale = Math.min(
              canvas.width / v.videoWidth,
              canvas.height / v.videoHeight,
            );
            try {
              ctx.drawImage(
                v,
                (canvas.width - v.videoWidth * scale) / 2,
                (canvas.height - v.videoHeight * scale) / 2,
                v.videoWidth * scale,
                v.videoHeight * scale,
              );
            } catch {}
          }
        }
      }
      const sign = direction === "next" ? -1 : 1;
      setSettling(false);
      setLeaving(offset);
      setDrag(offset - sign * height);
      if (direction === "next") next();
      else previous();
      motionFrame.current = requestAnimationFrame(() => {
        motionFrame.current = requestAnimationFrame(() => {
          setSettling(true);
          setLeaving(sign * height);
          setDrag(0);
        });
      });
    }
    clearTimeout(motionTimer.current);
    motionTimer.current = setTimeout(() => {
      setSettling(false);
      setLeaving(null);
      setDrag(0);
      motionLock.current = false;
    }, 220);
  };
  const [expanded, setExpanded] = useState(false);
  const setSource = (c: Clip) => {
    if (loaded.current === c.url) return;
    feedback("leave");
    beginObservation(c);
    generation.current++;
    setWarmReady(false);
    const cached = urls.current.indexOf(c.url);
    const index =
      cached >= 0
        ? cached
        : ([0, 1, 2].find(
            (i) => i !== activeSlot.current && !urls.current[i],
          ) ?? (activeSlot.current + 1) % 3);
    const v = slots.current[index];
    if (!v) return;
    const old = video.current;
    activeSlot.current = index;
    video.current = v;
    loaded.current = c.url;
    if (old && old !== v) {
      old.pause();
      old.muted = true;
    }
    if (urls.current[index] !== c.url) {
      urls.current[index] = c.url;
      v.preload = "auto";
      v.src = playbackUrl(c.url);
    } else {
      if (v.error) v.load();
      try {
        v.currentTime = 0;
      } catch {}
    }
    v.preload = "auto";
    v.muted = volume === 0;
    v.volume = volume;
    setSlotView({ active: index, urls: [...urls.current] });
    setTime(0);
    setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    setMessage("");
    setBlocked(false);
    setNeedsSound(false);
    setBuffering(v.readyState < 3);
  };
  useEffect(() => {
    // Retain cached neighbors, but never download an uncached previous clip.
    // Current playback gets the connection before any speculative next request.
    const targets = [preload?.url, previousClip?.url].filter(
      (x): x is string => !!x && x !== loaded.current,
    );
    const reserved = new Set([activeSlot.current]);
    for (const url of targets) {
      const index = urls.current.indexOf(url);
      if (index >= 0) reserved.add(index);
    }
    for (const url of targets) {
      if (urls.current.includes(url)) continue;
      if (
        url !== preload?.url ||
        !warmReady ||
        !wantPlay ||
        !video.current ||
        !canWarmNeighbor(video.current, !document.hidden, wanted.current)
      )
        continue;
      const index = [0, 1, 2].find((i) => !reserved.has(i));
      if (index === undefined) break;
      const v = slots.current[index];
      if (!v) continue;
      reserved.add(index);
      v.pause();
      v.muted = true;
      urls.current[index] = url;
      v.preload = "auto";
      v.src = playbackUrl(url);
    }
    // Release irrelevant files when a source changes; never fetch an archive.
    for (let i = 0; i < 3; i++)
      if (!reserved.has(i) && urls.current[i]) {
        slots.current[i]?.pause();
        slots.current[i]?.removeAttribute("src");
        slots.current[i]?.load();
        urls.current[i] = "";
      }
    setSlotView({ active: activeSlot.current, urls: [...urls.current] });
  }, [clip?.url, preload?.url, previousClip?.url, warmReady, wantPlay]);
  useEffect(() => {
    document.addEventListener("visibilitychange", updateWarmReady);
    return () =>
      document.removeEventListener("visibilitychange", updateWarmReady);
  }, []);
  const attempt = () => {
    const v = video.current;
    if (!v || !loaded.current) return;
    const token = generation.current;
    wanted.current = true;
    void v
      .play()
      .then(() => {
        if (token === generation.current) setBlocked(false);
      })
      .catch(async (e: Error) => {
        if (
          token !== generation.current ||
          !wanted.current ||
          e.name === "AbortError"
        )
          return;
        if (e.name === "NotAllowedError") {
          // Keep the stream moving when the browser allows muted video but not sound.
          v.muted = true;
          setNeedsSound(true);
          try {
            await v.play();
            if (token === generation.current) setBlocked(false);
          } catch {
            if (token === generation.current) {
              setBlocked(true);
              handlers.current.setWantPlay(false);
              setBuffering(false);
            }
          }
        } else {
          setBuffering(false);
          feedback("error");
          handlers.current.onError();
        }
      });
  };
  useImperativeHandle(ref, () => ({
    checkpoint: () => ({
      url: loaded.current,
      time:
        resumePending.current?.url === loaded.current
          ? resumePending.current.time
          : video.current?.currentTime || 0,
    }),
    mute: () => sound(volume && !needsSound ? 0 : lastVolume.current),
    fullscreen,
    feedback,
    start(c) {
      if (c && loaded.current === c.url) {
        feedback("leave");
        beginObservation(c);
        observation.current.duration = video.current?.duration || 0;
      }
      wanted.current = true;
      if (c && loaded.current === c.url && video.current)
        video.current.currentTime = 0;
      if (c) setSource(c);
      attempt();
    },
    hold() {
      wanted.current = false;
      video.current?.pause();
    },
  }));
  useLayoutEffect(() => {
    if (resumePending.current?.url !== clip?.url)
      resumePending.current = undefined;
    if (clip) {
      setSource(clip);
      if (wanted.current) attempt();
    } else {
      // No selected clip means no audible or pending media, including old slots.
      generation.current++;
      loaded.current = "";
      for (const v of slots.current) {
        if (!v) continue;
        v.pause();
        v.muted = true;
        v.removeAttribute("src");
        v.load();
      }
      urls.current = ["", "", ""];
      setSlotView({ active: activeSlot.current, urls: ["", "", ""] });
      setTime(0);
      setDuration(0);
      setPaused(true);
      setWarmReady(false);
      setBuffering(false);
    }
    // Switching to a neighbor preserves its existing decoder and buffer.
  }, [clip?.url]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.volume = Math.min(1, Math.max(0, volume));
  }, [volume]);
  useEffect(() => {
    wanted.current = wantPlay;
    if (wantPlay && clip) attempt();
    else if (!wantPlay) video.current?.pause();
  }, [wantPlay]);
  useEffect(
    () => () => {
      wanted.current = false;
      video.current?.pause();
    },
    [],
  );
  useEffect(() => {
    if (!buffering || !wantPlay || !clip) return;
    const timer = setTimeout(() => {
      setBuffering(false);
      setMessage("Этот ролик не отвечает — идём дальше");
      feedback("error");
      handlers.current.onError();
    }, 15000);
    return () => clearTimeout(timer);
  }, [buffering, wantPlay, clip?.url]);
  const toggle = () => {
    if (wantPlay) {
      wanted.current = false;
      video.current?.pause();
      setWantPlay(false);
    } else {
      wanted.current = true;
      setWantPlay(true);
      attempt();
    }
  };
  const sound = (value: number) => {
    const v = video.current;
    if (value > 0) lastVolume.current = value;
    setVolume(value);
    if (v) {
      v.volume = value;
      v.muted = value === 0;
    }
    setNeedsSound(false);
    if (wantPlay) attempt();
  };
  function fullscreen() {
    if (expanded || document.fullscreenElement) {
      setExpanded(false);
      if (document.fullscreenElement) void document.exitFullscreen();
    } else {
      setExpanded(true);
      // Preserve all controls on iPhone and embedded WebKit without Fullscreen API.
      if (frame.current?.requestFullscreen)
        void frame.current.requestFullscreen().catch(() => {});
    }
  }
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    const changed = () => {
      if (!document.fullscreenElement) setExpanded(false);
    };
    window.addEventListener("keydown", escape);
    document.addEventListener("fullscreenchange", changed);
    return () => {
      window.removeEventListener("keydown", escape);
      document.removeEventListener("fullscreenchange", changed);
    };
  }, []);
  useEffect(() => {
    const leave = () => feedback("leave");
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, []);
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    if (clip && typeof MediaMetadata !== "undefined")
      session.metadata = new MediaMetadata({
        title: clip.title,
        artist: "/" + clip.board + "/",
        album: "WebM TV",
      });
    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      [
        "play",
        () => {
          setWantPlay(true);
          attempt();
        },
      ],
      [
        "pause",
        () => {
          video.current?.pause();
          setWantPlay(false);
        },
      ],
      ["nexttrack", next],
      ["previoustrack", previous],
      [
        "seekto",
        (d) => {
          if (video.current && d.seekTime !== undefined)
            video.current.currentTime = d.seekTime;
        },
      ],
    ];
    for (const [name, handler] of actions) {
      try {
        session.setActionHandler(name, handler);
      } catch {}
    }
    session.playbackState = paused ? "paused" : "playing";
    return () => {
      for (const [name] of actions) {
        try {
          session.setActionHandler(name, null);
        } catch {}
      }
    };
  }, [clip, paused, next, previous]);
  const fmt = (n: number) =>
    Number.isFinite(n)
      ? `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`
      : "0:00";
  return (
    <div
      className={`player ${expanded ? "is-expanded" : ""} ${paused ? "is-paused" : "is-playing"} ${clip ? "has-video" : ""}`}
      ref={frame}
      data-testid="player-surface"
      onPointerDown={(e) => {
        if (
          !clip ||
          motionLock.current ||
          !e.isPrimary ||
          (e.target as HTMLElement).closest("button,input,a")
        )
          return;
        gesture.current = {
          x: e.clientX,
          y: e.clientY,
          at: Date.now(),
          height: e.currentTarget.clientHeight,
        };
        setSettling(false);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (!g) return;
        const dy = e.clientY - g.y,
          dx = e.clientX - g.x;
        if (Math.abs(dy) > Math.abs(dx)) {
          const available = dy < 0 ? !!preload : canPrevious;
          setDrag(
            available ? Math.max(-g.height, Math.min(g.height, dy)) : dy * 0.18,
          );
        }
      }}
      onPointerCancel={() => {
        gesture.current = null;
        settle(null, 0, 0);
      }}
      onPointerUp={(e) => {
        const g = gesture.current;
        gesture.current = null;
        if (!g) return;
        const dy = e.clientY - g.y,
          dx = e.clientX - g.x;
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) {
          setDrag(0);
          return;
        }
        const direction = swipeRelease(dx, dy, Date.now() - g.at, g.height);
        e.preventDefault();
        settle(
          (direction === "next" && !preload) ||
            (direction === "previous" && !canPrevious)
            ? null
            : direction,
          drag,
          g.height,
        );
      }}
      onClick={(e) => {
        if (Date.now() < suppressClick.current) return;
        if ((e.target as HTMLElement).closest("button,input,a")) return;
        if (clip) toggle();
      }}
    >
      <canvas
        ref={snapshot}
        className="swipe-departure"
        aria-hidden="true"
        style={{
          visibility: leaving === null ? "hidden" : "visible",
          transform: `translate3d(0,${leaving || 0}px,0)`,
          transition: settling
            ? "transform 170ms cubic-bezier(.22,.75,.2,1)"
            : "none",
        }}
      />
      <div
        className="swipe-page"
        data-testid="swipe-page"
        style={{
          transform: `translate3d(0,${drag}px,0)`,
          transition: settling
            ? "transform 170ms cubic-bezier(.22,.75,.2,1)"
            : "none",
        }}
      >
        {[0, 1, 2].map((index) => (
          <video
            key={index}
            ref={(node) => {
              slots.current[index] = node;
              if (index === activeSlot.current) video.current = node;
            }}
            playsInline
            preload={
              slotView.active === index ||
              (warmReady && wantPlay && slotView.urls[index] === preload?.url)
                ? "auto"
                : "metadata"
            }
            aria-label={slotView.active === index ? "Видео эфира" : undefined}
            aria-hidden={slotView.active !== index}
            data-slot={index}
            style={{
              position: "absolute",
              inset: 0,
              visibility:
                clip &&
                (slotView.active === index ||
                  slotView.urls[index] === preload?.url ||
                  slotView.urls[index] === previousClip?.url)
                  ? "visible"
                  : "hidden",
              transform:
                slotView.active === index
                  ? "translateY(0)"
                  : slotView.urls[index] === previousClip?.url
                    ? "translateY(-100%)"
                    : "translateY(100%)",
            }}
            onPlay={() => {
              if (index !== activeSlot.current) return;
              setPaused(false);
              setBlocked(false);
            }}
            onPause={() => {
              if (index === activeSlot.current) setPaused(true);
            }}
            onPlaying={() => {
              if (index !== activeSlot.current) return;
              setBuffering(false);
              updateWarmReady();
              onPlaying();
            }}
            onWaiting={() => {
              if (index !== activeSlot.current) return;
              setBuffering(true);
              setWarmReady(false);
              // Abort an unfinished speculative request when playback starves.
              for (let i = 0; i < 3; i++) {
                const neighbor = slots.current[i];
                if (
                  i !== index &&
                  neighbor &&
                  neighbor.readyState < 3 &&
                  urls.current[i]
                ) {
                  neighbor.removeAttribute("src");
                  neighbor.load();
                  urls.current[i] = "";
                }
              }
            }}
            onCanPlay={() => {
              if (index === activeSlot.current) setBuffering(false);
            }}
            onProgress={() => {
              if (index === activeSlot.current) updateWarmReady();
            }}
            onTimeUpdate={() => {
              if (index !== activeSlot.current) return;
              const v = video.current;
              if (!v) return;
              const wall = performance.now();
              observation.current.watched += watchDelta(
                v.currentTime - lastTick.current.media,
                (wall - lastTick.current.wall) / 1000,
                !document.hidden &&
                  !v.paused &&
                  !v.seeking &&
                  v.readyState >= 3,
              );
              observation.current.duration = v.duration;
              lastTick.current = { media: v.currentTime, wall };
              setTime(v.currentTime);
              updateWarmReady();
            }}
            onSeeking={() => {
              if (index !== activeSlot.current) return;
              lastTick.current = {
                media: video.current?.currentTime || 0,
                wall: performance.now(),
              };
            }}
            onSeeked={() => {
              if (index !== activeSlot.current) return;
              lastTick.current = {
                media: video.current?.currentTime || 0,
                wall: performance.now(),
              };
            }}
            onLoadedMetadata={() => {
              if (index !== activeSlot.current) return;
              const v = video.current;
              setDuration(v?.duration || 0);
              const restore = resumePending.current;
              if (
                v &&
                restore &&
                loaded.current === restore.url &&
                Number.isFinite(v.duration)
              ) {
                v.currentTime = Math.min(
                  restore.time,
                  Math.max(0, v.duration - 0.1),
                );
                setTime(v.currentTime);
                lastTick.current = {
                  media: v.currentTime,
                  wall: performance.now(),
                };
                resumePending.current = undefined;
              }
            }}
            onEnded={() => {
              if (index !== activeSlot.current) return;
              feedback("ended");
              if (stopAtEnd) {
                wanted.current = false;
                setWantPlay(false);
              } else next();
            }}
            onError={() => {
              if (index !== activeSlot.current) {
                if (preload && urls.current[index] === preload.url)
                  onPreloadError(preload);
                return;
              }
              if (clip && loaded.current === clip.url) {
                setBuffering(false);
                feedback("error");
                handlers.current.onError();
              }
            }}
          />
        ))}
        {!clip && (
          <div className="empty-player">
            <div className="signal">
              <Radio size={36} strokeWidth={1} />
            </div>
            <h2>{busy ? "Подбираем видео" : startHeading}</h2>
            <p>{status}</p>
            {!busy && (
              <button
                className="primary"
                onClick={() => {
                  setWantPlay(true);
                  attempt();
                }}
              >
                <Play size={17} />
                {startLabel}
              </button>
            )}
            {busy && <LoaderCircle className="spin" />}
            <span>Выбрать тему можно в любой момент</span>
          </div>
        )}
        {clip && (!wantPlay || blocked) && (
          <button
            className="play-overlay"
            aria-label="Продолжить воспроизведение"
            onClick={() => {
              setWantPlay(true);
              attempt();
            }}
          >
            <Play size={30} />
          </button>
        )}
        {clip && buffering && (
          <div className="buffering">
            <LoaderCircle className="spin" size={18} />
            <span>Загружаем следующий</span>
          </div>
        )}
        {clip && needsSound && (
          <button
            className="enable-sound"
            onClick={() => sound(volume || 0.65)}
          >
            <VolumeX size={16} />
            Включить звук
          </button>
        )}
        {clip && blocked && (
          <div className="player-message">
            Браузер остановил видео. Коснитесь экрана.
          </div>
        )}
        {clip && message && <div className="player-message">{message}</div>}
        {children}
      </div>
      <div className="player-controls">
        <input
          className="seek"
          aria-label="Перемотка"
          type="range"
          min="0"
          max={duration || 1}
          step=".1"
          value={Math.min(time, duration || 1)}
          disabled={!clip}
          onChange={(e) => {
            if (video.current)
              video.current.currentTime = Number(e.target.value);
          }}
        />
        <div className="transport">
          <button
            aria-label={paused ? "Воспроизвести" : "Пауза"}
            onClick={toggle}
          >
            {paused ? <Play /> : <Pause />}
          </button>
          <button
            aria-label="Предыдущий ролик"
            disabled={!canPrevious}
            onClick={previous}
          >
            <SkipBack size={19} />
          </button>
          <button aria-label="Следующий ролик" onClick={next} disabled={!clip}>
            <SkipForward size={19} />
          </button>
          <span className="time">
            {fmt(time)} <span>/ {fmt(duration)}</span>
          </span>
          <div className="volume">
            <button
              aria-label={
                volume && !needsSound ? "Выключить звук" : "Включить звук"
              }
              onClick={() => sound(volume && !needsSound ? 0 : 0.65)}
            >
              {volume && !needsSound ? (
                <Volume2 size={19} />
              ) : (
                <VolumeX size={19} />
              )}
            </button>
            <input
              aria-label="Громкость"
              type="range"
              min="0"
              max="1"
              step=".05"
              value={volume}
              onChange={(e) => sound(Number(e.target.value))}
            />
          </div>
          <button
            aria-label="Полный экран"
            title="Полный экран (F)"
            onClick={fullscreen}
          >
            <Maximize size={19} />
          </button>
        </div>
      </div>
    </div>
  );
});
