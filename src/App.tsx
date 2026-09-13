import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Clock,
  Bookmark,
  Check,
  ChevronRight,
  ExternalLink,
  EyeOff,
  Layers,
  LoaderCircle,
  Menu,
  Plus,
  Radio,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import type { Board, Clip, Collection, Feed, Source } from "../shared/model";
import { normalizeSources, sourceKey } from "../shared/model";
import { api } from "./api";
import { useStored, read, save } from "./storage";
import { chooseClip, ignoreHotkey } from "./queue";
import { Tree } from "./Tree";
import { Player, type PlayerHandle } from "./Player";
import {
  learn,
  interestWeight,
  type Profile,
  type Observation,
} from "./preferences";
import { matchesDuration } from "./duration";
import { DurationMenu } from "./DurationMenu";
const ROOT: Source = { kind: "root", id: "all", label: "Весь Двач" };
export default function App() {
  const [personalized, setPersonalized] = useStored("personalized", true);
  const profile = useRef<Profile>(read("interests-v1", {}));
  const observe = (o: Observation) => {
    if (!personalized) return;
    profile.current = learn(profile.current, o);
    save("interests-v1", profile.current);
  };
  const [collapsed, setCollapsed] = useStored("sidebarCollapsed", false);
  const [onlyLong, setOnlyLong] = useStored("onlyLong", false);
  const [minimum, setMinimum] = useStored("minimumDuration", 60);
  const playerRef = useRef<PlayerHandle>(null);
  const knownClips = useRef(new Map<string, Clip>());
  const [prepared, setPrepared] = useState<Clip>();
  const [returnSource, setReturnSource] = useState<{
    selection: Source;
    sources: Source[];
  } | null>(null);
  const retryTree = useRef<() => void>(() => {});
  const [treeMinimum, setTreeMinimum] = useState<number | null>(null);
  const filterMinimum = onlyLong ? minimum : 0;
  const [boards, setBoards] = useState<Board[]>([]),
    [treeError, setTreeError] = useState("");
  const [selection, setSelection] = useState<Source>(ROOT),
    [sources, setSources] = useState<Source[]>([ROOT]);
  const [includeAdult, setAdult] = useStored("includeAdult", false);
  const [collections, setCollections] = useStored<Collection[]>(
    "collections",
    [],
  );
  const [saved, setSaved] = useStored<Clip[]>("saved", []);
  const [hidden, setHidden] = useStored<string[]>("hidden", []);
  const [basket, setBasket] = useState<Source[]>([]),
    [name, setName] = useState(""),
    [drawer, setDrawer] = useState<"sources" | "saved" | null>(null),
    [mobile, setMobile] = useState(false);
  const [started, setStarted] = useState(false),
    [revision, setRevision] = useState(0),
    [feed, setFeed] = useState<Feed | null>(null),
    [rawClips, setClips] = useState<Clip[]>([]),
    [error, setError] = useState(""),
    [wantPlay, setWantPlay] = useState(false);
  const [history, setHistory] = useState<Clip[]>([]),
    [position, setPosition] = useState(-1),
    [toast, setToast] = useState("");
  const seen = useRef(new Set(read<string[]>("seen", [])));
  const failed = useRef(new Set<string>());
  const failures = useRef(0);
  const waitingForMore = useRef(false);
  const clip = history[position];
  const clips = useMemo(
    () => rawClips.filter((c) => matchesDuration(c, onlyLong, minimum)),
    [rawClips, onlyLong, minimum],
  );
  const changeDuration = (enabled: boolean, seconds = minimum) => {
    playerRef.current?.feedback("leave");
    setOnlyLong(enabled);
    setMinimum(seconds);
    setPrepared(undefined);
    const keep = clip && matchesDuration(clip, enabled, seconds);
    setHistory(keep ? [clip] : []);
    setPosition(keep ? 0 : -1);
    if (!keep) {
      playerRef.current?.hold();
      setWantPlay(started);
    }
  };
  const durationControls = (
    <div className={`duration-filter ${onlyLong ? "enabled" : ""}`}>
      <label className="duration-toggle">
        <input
          type="checkbox"
          role="switch"
          aria-label="Только длинные"
          checked={onlyLong}
          onChange={(e) => changeDuration(e.target.checked)}
        />
        <span>Длинные</span>
      </label>
      {onlyLong && (
        <DurationMenu
          value={minimum}
          onChange={(v) => changeDuration(true, v)}
        />
      )}
    </div>
  );
  const key = sources.map(sourceKey).join("|");
  useEffect(() => {
    if (!drawer) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const elements = () => [
      ...(dialog?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),a[href],input,summary",
      ) || []),
    ];
    elements()[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawer(null);
      if (event.key !== "Tab") return;
      const items = elements(),
        first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [drawer]);
  useEffect(() => {
    if (!started || !feed?.progress.done) return;
    const timer = setInterval(() => setRevision((v) => v + 1), 300_000);
    return () => clearInterval(timer);
  }, [started, key, feed?.progress.done]);
  useEffect(() => {
    let alive = true;
    let pending = false;
    let controller: AbortController | undefined;
    const refresh = async () => {
      if (!alive || pending) return;
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 20_000);
      try {
        const d = await api<{ boards: Board[] }>(
          `/tree?minimum=${filterMinimum}`,
          {
            signal: controller.signal,
          },
        );
        if (!alive) return;
        setBoards(d.boards);
        setTreeMinimum(filterMinimum);
        setTreeError("");
        for (const c of d.boards.flatMap((b) => b.samples || []))
          knownClips.current.set(c.id, c);
      } catch {
        if (alive)
          setTreeError("Не удалось обновить темы. Повторяем автоматически.");
      } finally {
        clearTimeout(timeout);
        pending = false;
      }
    };
    retryTree.current = refresh;
    setTreeError("");
    void refresh();
    const timer = setInterval(refresh, 5000);
    window.addEventListener("online", refresh);
    return () => {
      alive = false;
      controller?.abort();
      clearInterval(timer);
      window.removeEventListener("online", refresh);
    };
  }, [filterMinimum]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!started) return;
    let disposed = false,
      id = "",
      timer: ReturnType<typeof setTimeout>;
    let offset = 0;
    const all: Clip[] = [];
    const cancel = () => {
      disposed = true;
      clearTimeout(timer);
      if (id)
        void api("/feeds/" + id, { method: "DELETE", keepalive: true }).catch(
          () => {},
        );
    };
    window.addEventListener("pagehide", cancel);
    setError("");
    setFeed(null);
    async function poll() {
      try {
        const d = await api<Feed & { nextOffset: number; total: number }>(
          `/feeds/${id}?offset=${offset}`,
        );
        if (disposed) return;
        all.push(...d.clips);
        for (const c of d.clips) knownClips.current.set(c.id, c);
        offset = d.nextOffset;
        setClips([...new Map(all.map((c) => [c.id, c])).values()]);
        setFeed(d);
        if (!d.progress.done || offset < d.total)
          timer = setTimeout(poll, offset < d.total ? 50 : 1200);
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
    }
    api<{ id: string }>("/feeds", {
      method: "POST",
      body: JSON.stringify({ sources, includeAdult }),
    })
      .then((d) => {
        id = d.id;
        if (disposed) {
          void api("/feeds/" + id, { method: "DELETE" }).catch(() => {});
          return;
        }
        void poll();
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      window.removeEventListener("pagehide", cancel);
      cancel();
    };
  }, [key, includeAdult, started, revision]);
  const markSeen = (c: Clip) => {
    seen.current.add(c.id);
    save("seen", [...seen.current].slice(-10000));
  };
  const pick = (pool: Clip[], current?: Clip) => {
    pool = pool.filter((c) => matchesDuration(c, onlyLong, minimum));
    const excluded = new Set([...hidden, ...failed.current]);
    const fresh = chooseClip(
      pool,
      seen.current,
      excluded,
      current,
      personalized ? (c) => interestWeight(profile.current, c) : undefined,
    );
    if (fresh) return fresh;
    // A watched channel is not an empty channel: start another shuffled pass.
    const other = pool.filter((c) => c.id !== current?.id);
    return chooseClip(
      other.length ? other : pool,
      new Set(),
      excluded,
      current,
      personalized ? (c) => interestWeight(profile.current, c) : undefined,
    );
  };
  const append = (c: Clip) => {
    if (!matchesDuration(c, onlyLong, minimum)) {
      setToast("Ролик не подходит под выбранную длительность");
      return;
    }
    markSeen(c);
    setPrepared(undefined);
    playerRef.current?.start(c);
    setHistory((h) => [...h.slice(0, position + 1), c].slice(-200));
    setPosition((p) => Math.min(p + 1, 199));
    setWantPlay(true);
  };
  useEffect(() => {
    if (
      prepared &&
      matchesDuration(prepared, onlyLong, minimum) &&
      clips.some((c) => c.id === prepared.id) &&
      !seen.current.has(prepared.id) &&
      !hidden.includes(prepared.id) &&
      !failed.current.has(prepared.id)
    )
      return;
    setPrepared(pick(clips, clip));
  }, [clips, clip?.id, hidden, key]);
  const next = () => {
    playerRef.current?.feedback("skip");
    waitingForMore.current = false;
    if (position < history.length - 1) {
      const c = history[position + 1];
      playerRef.current?.start(c);
      setPosition(position + 1);
      setWantPlay(true);
      return;
    }
    const c =
      prepared &&
      clips.some((x) => x.id === prepared.id) &&
      !failed.current.has(prepared.id) &&
      !hidden.includes(prepared.id)
        ? prepared
        : pick(clips, clip);
    if (c) append(c);
    else {
      waitingForMore.current = !feed?.progress.done;
      setToast(
        feed?.progress.done
          ? "Доступные ролики закончились"
          : "Подбираем следующий ролик…",
      );
    }
  };
  useEffect(() => {
    if ((!clip || waitingForMore.current) && started && clips.length) {
      const c = pick(clips);
      if (c) {
        waitingForMore.current = false;
        append(c);
      }
    }
  }, [clips, clip, started]);
  const previous = () => {
    if (position > 0) {
      playerRef.current?.start(history[position - 1]);
      setPosition(position - 1);
      setWantPlay(true);
    }
  };
  const choose = (s: Source, list: Source[] = [s], continuing?: Clip) => {
    setReturnSource(null);
    waitingForMore.current = false;
    failed.current.clear();
    failures.current = 0;
    const pool = [...knownClips.current.values()].filter((c) => {
      const board = boards.find((b) => b.id === c.board);
      if (!includeAdult && board?.adult) return false;
      return list.some(
        (x) =>
          x.kind === "root" ||
          (x.kind === "category" && board?.category === x.id) ||
          (x.kind === "board" && x.id === c.board) ||
          (x.kind === "thread" && x.board === c.board && x.id === c.thread),
      );
    });
    const first =
      continuing && matchesDuration(continuing, onlyLong, minimum)
        ? continuing
        : pick(pool);
    setSelection(s);
    setSources(list);
    setPrepared(undefined);
    setClips(pool);
    setFeed(null);
    setStarted(true);
    setWantPlay(continuing ? wantPlay : true);
    setMobile(false);
    setError("");
    if (first) {
      markSeen(first);
      if (!continuing) playerRef.current?.start(first);
      setHistory([first]);
      setPosition(0);
    } else {
      playerRef.current?.hold();
      setHistory([]);
      setPosition(-1);
    }
    setRevision((v) => v + 1);
  };
  const changeAdult = (v: boolean) => {
    setAdult(v);
    setHistory([]);
    setPosition(-1);
    setClips([]);
    setPrepared(undefined);
    playerRef.current?.hold();
    setWantPlay(true);
  };
  const play = (v: boolean) => {
    waitingForMore.current = false;
    if (v) {
      failures.current = 0;
      if (!started || !clip) {
        choose(selection, sources);
        return;
      }
      playerRef.current?.start();
    } else playerRef.current?.hold();
    setStarted(true);
    setWantPlay(v);
  };
  const stayInThread = () => {
    if (!clip || selection.kind === "thread") return;
    const previous = { selection, sources };
    const thread: Source = {
      kind: "thread",
      id: clip.thread,
      board: clip.board,
      label: clip.title,
    };
    choose(thread, [thread], clip);
    setReturnSource(previous);
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        ignoreHotkey(e.target) ||
        drawer
      )
        return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        previous();
      } else if (e.code === "KeyF") {
        e.preventDefault();
        playerRef.current?.fullscreen();
      } else if (e.code === "KeyM") {
        e.preventDefault();
        playerRef.current?.mute();
      } else if (e.code === "Space") {
        e.preventDefault();
        play(!wantPlay);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const bookmark = (c: Clip) => {
    if (!saved.some((x) => x.id === c.id))
      observe({ clip: c, watched: 0, duration: 0, reason: "save" });
    setSaved((old) =>
      old.some((x) => x.id === c.id)
        ? old.filter((x) => x.id !== c.id)
        : [c, ...old],
    );
  };
  const toggle = (s: Source) =>
    setBasket((b) =>
      b.some((x) => sourceKey(x) === sourceKey(s))
        ? b.filter((x) => sourceKey(x) !== sourceKey(s))
        : [...b, s],
    );
  const onError = () => {
    if (!clip || failed.current.has(clip.id)) return;
    failed.current.add(clip.id);
    failures.current++;
    if (failures.current >= 5) {
      setWantPlay(false);
      setError(
        "Несколько видео подряд недоступны. Проверьте соединение или выберите другую ветку.",
      );
    } else next();
  };
  const saveCollection = () => {
    if (!basket.length || !name.trim()) return;
    const c = {
      id:
        crypto.randomUUID?.() ||
        Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
      name: name.trim(),
      sources: normalizeSources(basket, boards),
    };
    setCollections((old) => [...old, c]);
    setBasket([]);
    setName("");
    setToast("Подборка сохранена");
    setDrawer(null);
    choose(
      { kind: "category", id: "collection:" + c.id, label: c.name },
      c.sources,
    );
  };
  const p = feed?.progress;
  const adultSelected = sources.some(
    (s) =>
      (s.kind === "category" && s.id === "Взрослым") ||
      boards.some(
        (b) =>
          b.adult &&
          ((s.kind === "board" && s.id === b.id) ||
            (s.kind === "thread" && s.board === b.id)),
      ),
  );
  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <div className="brand">
          <strong className="brand-name">
            WEBM TV <span>/</span>
          </strong>
          <button
            className="collapse-toggle"
            aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Развернуть меню" : "Свернуть меню"}
          >
            {collapsed ? (
              <PanelLeftOpen size={20} />
            ) : (
              <PanelLeftClose size={20} />
            )}
          </button>
          <button
            className="mobile-close"
            aria-label="Закрыть каналы"
            onClick={() => setMobile(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav className="sidebar-rail" aria-label="Быстрые действия">
          <button
            title="Весь Двач"
            aria-label="Весь Двач"
            onClick={() => choose(ROOT)}
          >
            <Radio size={21} />
          </button>
          <button
            title="Найти канал"
            aria-label="Найти канал"
            onClick={() => setCollapsed(false)}
          >
            <Menu size={21} />
          </button>
          <button
            title="Сохранённое"
            aria-label="Сохранённое"
            onClick={() => setDrawer("saved")}
          >
            <Bookmark size={21} />
          </button>
          <button
            title={onlyLong ? "Все длительности" : "Только длинные"}
            aria-label="Только длинные"
            aria-pressed={onlyLong}
            onClick={() => changeDuration(!onlyLong)}
          >
            <Clock size={21} />
          </button>
          <button
            title="Настройки эфира"
            aria-label="Настройки эфира"
            onClick={() => setDrawer("sources")}
          >
            <SlidersHorizontal size={21} />
          </button>
        </nav>
        <div className="sidebar-content">
          {durationControls}
          {treeError && (
            <div className="tree-note tree-refresh-note" role="status">
              <span>{treeError}</span>
              <button onClick={() => retryTree.current()}>Повторить</button>
            </div>
          )}
          {treeMinimum === null ? (
            !treeError && (
              <div className="tree-note">
                <LoaderCircle className="spin" size={16} />
                Получаем доски Двача
              </div>
            )
          ) : (
            <Tree
              boards={treeMinimum === filterMinimum ? boards : []}
              minimum={filterMinimum}
              selected={selection}
              select={choose}
              basket={basket}
              toggle={toggle}
              collections={collections}
              openCollection={(c) =>
                choose(
                  { kind: "category", id: "collection:" + c.id, label: c.name },
                  c.sources,
                )
              }
              includeAdult={includeAdult}
              setAdult={changeAdult}
              onSamples={(samples) => {
                for (const c of samples) knownClips.current.set(c.id, c);
              }}
            />
          )}
          <button
            className="basket-button"
            onClick={() => setDrawer("sources")}
          >
            <Plus size={18} />
            {basket.length
              ? `Объединить выбранное · ${basket.length}`
              : "Собрать подборку"}
          </button>
        </div>
      </aside>
      {mobile && (
        <button
          className="mobile-backdrop"
          aria-label="Закрыть меню каналов"
          onClick={() => setMobile(false)}
        />
      )}
      <main className="main">
        <header className="main-header">
          <div className="heading">
            <button
              className="menu-button"
              aria-label="Открыть каналы"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </button>
            <div>
              <div className="eyebrow">ЭФИР ДВАЧА</div>
              <h1>{selection.label}</h1>
            </div>
          </div>
          <div className="header-actions">
            <div
              className="header-transport mobile-transport"
              role="group"
              aria-label="Переключение роликов"
            >
              <button
                aria-label="Назад"
                title="Предыдущий ролик (←)"
                disabled={position <= 0}
                onClick={previous}
              >
                <ArrowLeft size={17} />
                <span>Назад</span>
              </button>
              <button
                aria-label="Дальше"
                title="Следующий ролик (→)"
                disabled={!clip}
                onClick={next}
              >
                <span>Дальше</span>
                <ArrowRight size={17} />
              </button>
            </div>
            <button
              className="icon-button"
              aria-label="Сохранённые ролики"
              onClick={() => setDrawer("saved")}
            >
              <Bookmark size={18} />
            </button>
            <button
              aria-label="Источники"
              className="outline"
              onClick={() => setDrawer("sources")}
            >
              <SlidersHorizontal size={16} />
              <span>Источники</span>
            </button>
          </div>
        </header>
        <div className="channel-context">
          <span>
            <Radio size={13} />
            {selection.kind === "root"
              ? "Все категории"
              : selection.kind === "thread"
                ? `/${selection.board}/ · тред №${selection.id}`
                : sources.length > 1
                  ? `${sources.length} источника`
                  : "Включает вложенные треды"}
          </span>
          <span>
            {selection.kind === "thread"
              ? "Рандом внутри треда"
              : "Разные треды вперемешку"}
          </span>
        </div>
        <div className="viewing-area">
          {adultSelected && !includeAdult && (
            <div className="adult-notice">
              <h2>Ветка 18+</h2>
              <p>Включите взрослые источники, чтобы смотреть эту ветку.</p>
              <button className="primary" onClick={() => changeAdult(true)}>
                Включить 18+
              </button>
            </div>
          )}
          <Player
            ref={playerRef}
            clip={clip}
            preload={
              position < history.length - 1 ? history[position + 1] : prepared
            }
            previousClip={position > 0 ? history[position - 1] : undefined}
            wantPlay={wantPlay}
            setWantPlay={play}
            next={next}
            previous={previous}
            canPrevious={position > 0}
            busy={started && !p?.done && !error}
            status={
              error ||
              (p?.done
                ? clips.length
                  ? "Доступные ролики закончились. Попробуйте другую ветку."
                  : onlyLong
                    ? "Нет видео выбранной длительности. Уменьшите порог или выберите другую ветку."
                    : "В этой ветке пока нет доступных видео. Выберите другую."
                : started
                  ? "Собираем видео из тредов…"
                  : "Случайные видео из реальных тредов")
            }
            onFeedback={observe}
            onError={onError}
            onPlaying={() => {
              failures.current = 0;
            }}
          >
            {clip && (
              <>
                <div className="shorts-caption">
                  <span>/{clip.board}/</span>
                  <p>{clip.title}</p>
                  {selection.kind !== "thread" && (
                    <button onClick={stayInThread}>
                      Смотреть этот тред <ChevronRight size={14} />
                    </button>
                  )}
                </div>
                <div className="shorts-actions">
                  <button aria-label="Закладка" onClick={() => bookmark(clip)}>
                    {saved.some((s) => s.id === clip.id) ? (
                      <Check />
                    ) : (
                      <Bookmark />
                    )}
                  </button>
                  <button
                    aria-label="Не показывать ролик"
                    onClick={() => {
                      observe({
                        clip,
                        watched: 0,
                        duration: 0,
                        reason: "hide",
                      });
                      setHidden((h) => [...h, clip.id]);
                      failed.current.add(clip.id);
                      next();
                    }}
                  >
                    <EyeOff />
                  </button>
                  <button aria-label="Листать дальше" onClick={next}>
                    <ArrowRight className="swipe-up" />
                  </button>
                </div>
              </>
            )}
          </Player>
        </div>
        <div className="now-playing">
          <div>
            {clip ? (
              <>
                <a
                  className="origin"
                  href={`https://2ch.hk/${clip.board}/res/${clip.thread}.html#${clip.post}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  /{clip.board}/ <span>· {clip.title}</span>
                  <ExternalLink size={16} />
                </a>
                {selection.kind !== "thread" && (
                  <button className="thread-focus" onClick={stayInThread}>
                    Смотреть этот тред <ChevronRight size={13} />
                  </button>
                )}
                <div className="clip-detail">
                  {clip.width} × {clip.height} ·{" "}
                  {clip.url.toLowerCase().includes(".webm") ? "WEBM" : "MP4"}
                </div>
              </>
            ) : (
              <span className="muted">
                {started
                  ? "Видео появятся по мере загрузки"
                  : "Названия и темы — как на Дваче"}
              </span>
            )}
          </div>
          <div
            className="header-transport"
            role="group"
            aria-label="Переключение роликов"
          >
            <button
              aria-label="Назад"
              title="Предыдущий ролик (←)"
              disabled={position <= 0}
              onClick={previous}
            >
              <ArrowLeft size={17} />
              <span>Назад</span>
            </button>
            <button
              aria-label="Дальше"
              title="Следующий ролик (→)"
              disabled={!clip}
              onClick={next}
            >
              <span>Дальше</span>
              <ArrowRight size={17} />
            </button>
          </div>
          <div className="clip-actions">
            {clip && (
              <>
                <button
                  className={
                    saved.some((s) => s.id === clip.id) ? "marked" : ""
                  }
                  aria-label="Сохранить ролик"
                  onClick={() => bookmark(clip)}
                >
                  {saved.some((s) => s.id === clip.id) ? (
                    <Check size={20} />
                  ) : (
                    <Bookmark size={20} />
                  )}
                </button>
                <button
                  aria-label="Скрыть ролик"
                  onClick={() => {
                    observe({ clip, watched: 0, duration: 0, reason: "hide" });
                    setHidden((h) => [...h, clip.id]);
                    failed.current.add(clip.id);
                    next();
                    setToast("Ролик скрыт");
                  }}
                >
                  <EyeOff size={19} />
                </button>
              </>
            )}
            <button
              aria-label="Обновить эфир"
              title="Обновить эфир"
              onClick={() => {
                setStarted(true);
                setRevision((x) => x + 1);
              }}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </div>
        {returnSource && (
          <button
            className="return-stream"
            onClick={() => {
              choose(returnSource.selection, returnSource.sources);
              setReturnSource(null);
            }}
          >
            ← Вернуться: {returnSource.selection.label}
          </button>
        )}
        <div className="feed-status" aria-live="polite">
          {p ? (
            <>
              <span className={p.done ? "status-dot" : "status-dot working"} />
              {p.done ? "Эфир готов" : "Находим новые видео"} · {clips.length}{" "}
              видео{" "}
            </>
          ) : (
            <>
              <span className="status-dot idle" />
              Готов к просмотру
            </>
          )}
        </div>
        {error && (
          <div className="error-banner">
            {error ||
              `Часть источников недоступна (${p?.errors}). Остальные продолжают загружаться.`}
            <button
              onClick={() => {
                setError("");
                setRevision((x) => x + 1);
              }}
            >
              Повторить
            </button>
          </div>
        )}
        <footer>
          <span>Из тредов — в эфир.</span>
          <span>WebM TV / 0.2.0</span>
        </footer>
      </main>
      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(null)}>
          <section
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label={
              drawer === "sources"
                ? "Источники и подборки"
                : "Сохранённые ролики"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>{drawer === "sources" ? "Источники" : "Сохранённое"}</h2>
              <button
                aria-label="Закрыть панель"
                onClick={() => setDrawer(null)}
              >
                <X size={20} />
              </button>
            </header>
            {drawer === "sources" ? (
              <>
                {durationControls}
                {onlyLong && (
                  <p className="small muted">
                    Видео без указанной длительности исключены. Фильтр действует
                    внутри выбранных источников.
                  </p>
                )}
                <label className="adult-toggle">
                  <input
                    type="checkbox"
                    checked={personalized}
                    onChange={(e) => {
                      playerRef.current?.feedback("leave");
                      setPersonalized(e.target.checked);
                      setPrepared(undefined);
                    }}
                  />{" "}
                  Подстраивать эфир под меня
                </label>
                <p className="muted">
                  Учимся по досмотрам и пропускам. История интересов хранится
                  только в этом браузере.
                </p>
                <button
                  className="quiet"
                  onClick={() => {
                    playerRef.current?.feedback("leave");
                    profile.current = {};
                    save("interests-v1", {});
                    setPrepared(undefined);
                    setToast("Интересы сброшены");
                  }}
                >
                  Сбросить интересы
                </button>
                <p className="muted">
                  Категория → доска → тред. Название включает эфир, стрелка
                  раскрывает ветку.
                </p>
                {Object.entries(profile.current).filter(
                  ([k, v]) => k.includes(":") && v.sum > 0,
                ).length > 0 && (
                  <details>
                    <summary>Что влияет на эфир</summary>
                    {Object.entries(profile.current)
                      .filter(([k, v]) => k.includes(":") && v.sum > 0)
                      .sort(
                        (a, b) =>
                          b[1].sum / (3 + b[1].count) -
                          a[1].sum / (3 + a[1].count),
                      )
                      .slice(0, 5)
                      .map(([k, v]) => (
                        <p className="small muted" key={k}>
                          {v.label} · /{k.split(":")[0]}/
                        </p>
                      ))}
                  </details>
                )}
                <h3>Сейчас в эфире</h3>
                {sources.map((s) => (
                  <div className="source-item" key={sourceKey(s)}>
                    <Layers size={15} />
                    <span>
                      {s.label}
                      <small>
                        {s.kind === "thread"
                          ? `/${s.board}/ · №${s.id}`
                          : s.kind === "root"
                            ? "Все вложенные ветки"
                            : "Все вложенные треды"}
                      </small>
                    </span>
                  </div>
                ))}
                <label className="adult-toggle">
                  <input
                    type="checkbox"
                    checked={includeAdult}
                    onChange={(e) => changeAdult(e.target.checked)}
                  />
                  Включать категорию 18+
                </label>
                <p className="small muted">
                  Темы определяет сам Двач. Другие доски тоже могут содержать
                  взрослые материалы.
                </p>
                <hr />
                <h3>Объединить треды и ветки</h3>
                {basket.length === 0 ? (
                  <p className="muted">
                    Отметьте источники кнопкой + в дереве каналов.
                  </p>
                ) : (
                  basket.map((s) => (
                    <div className="source-item" key={sourceKey(s)}>
                      <span>{s.label}</span>
                      <button
                        aria-label={`Убрать ${s.label}`}
                        onClick={() => toggle(s)}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))
                )}
                <label className="field">
                  Название подборки
                  <input
                    placeholder="Мой эфир"
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <button
                  className="primary"
                  disabled={!basket.length || !name.trim()}
                  onClick={saveCollection}
                >
                  Сохранить и смотреть
                </button>
                {collections.length > 0 && (
                  <>
                    <h3>Мои подборки</h3>
                    {collections.map((c) => (
                      <div className="source-item" key={c.id}>
                        <button
                          className="text-button"
                          onClick={() => {
                            choose(
                              {
                                kind: "category",
                                id: "collection:" + c.id,
                                label: c.name,
                              },
                              c.sources,
                            );
                            setDrawer(null);
                          }}
                        >
                          {c.name}
                        </button>
                        <button
                          aria-label={`Удалить подборку ${c.name}`}
                          onClick={() =>
                            setCollections((old) =>
                              old.filter((x) => x.id !== c.id),
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </>
                )}
                {hidden.length > 0 && (
                  <button
                    className="quiet"
                    onClick={() => {
                      setHidden([]);
                      setToast("Скрытые ролики снова доступны");
                    }}
                  >
                    Вернуть скрытые ролики ({hidden.length})
                  </button>
                )}
                {p?.errors ? (
                  <details>
                    <summary>Ошибки источников</summary>
                    {feed?.issues.map((v, i) => (
                      <p className="small" key={i}>
                        {v}
                      </p>
                    ))}
                  </details>
                ) : null}
              </>
            ) : saved.length === 0 ? (
              <p className="muted">
                Сохраняйте понравившиеся ролики кнопкой закладки под видео.
              </p>
            ) : (
              saved.map((c) => (
                <div className="source-item" key={c.id}>
                  <button
                    className="text-button"
                    onClick={() => {
                      append(c);
                      setWantPlay(true);
                      setDrawer(null);
                    }}
                  >
                    /{c.board}/ · {c.title}
                  </button>
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Открыть файл"
                  >
                    <ExternalLink size={16} />
                  </a>
                </div>
              ))
            )}
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
