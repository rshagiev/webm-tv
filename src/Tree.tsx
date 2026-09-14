import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Plus,
  Check,
  Search,
  Radio,
  Folder,
  Layers,
  LoaderCircle,
  CircleAlert,
  EllipsisVertical,
} from "lucide-react";
import type { Board, Source, Topic, Collection, Clip } from "../shared/model";
import { sourceKey } from "../shared/model";
import { api } from "./api";
import { threadKey, type ThreadExclusion } from "./thread-exclusions";
type Props = {
  excludedThreads: ThreadExclusion[];
  excludeThread: (t: ThreadExclusion) => void;
  restoreThread: (t: ThreadExclusion) => void;
  publicMode?: boolean;
  boards: Board[];
  minimum: number;
  selected: Source;
  select: (s: Source) => void;
  basket: Source[];
  toggle: (s: Source) => void;
  collections: Collection[];
  openCollection: (c: Collection) => void;
  includeAdult: boolean;
  setAdult: (v: boolean) => void;
  onSamples: (clips: Clip[]) => void;
};
export function Tree({
  excludedThreads,
  excludeThread,
  restoreThread,
  publicMode = false,
  boards,
  minimum,
  selected,
  select,
  basket,
  toggle,
  collections,
  openCollection,
  includeAdult,
  setAdult,
  onSamples,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set()),
    [topics, setTopics] = useState<Record<string, Topic[]>>({}),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [query, setQuery] = useState("");
  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      for (const menu of document.querySelectorAll<HTMLDetailsElement>(
        "details.thread-menu[open]",
      ))
        if (e instanceof KeyboardEvent || !menu.contains(e.target as Node))
          menu.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  const filterRef = useRef(minimum);
  filterRef.current = minimum;
  const loading = useRef(new Set<string>()),
    sampleHandler = useRef(onSamples);
  sampleHandler.current = onSamples;
  const expand = (key: string) =>
    setExpanded((old) => {
      const n = new Set(old);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  const load = async (id: string) => {
    const requestedMinimum = minimum;
    const requestKey = id + ":" + requestedMinimum;
    if (loading.current.has(requestKey)) return;
    loading.current.add(requestKey);
    try {
      const d = await api<{ topics: Topic[] }>(
        `/boards/${id}?minimum=${requestedMinimum}`,
      );
      if (filterRef.current !== requestedMinimum) return;
      setTopics((s) => ({ ...s, [id]: d.topics }));
      sampleHandler.current(d.topics.flatMap((t) => t.samples || []));
      setErrors((s) => ({ ...s, [id]: "" }));
    } catch (e) {
      if (filterRef.current !== requestedMinimum) return;
      setErrors((s) => ({ ...s, [id]: (e as Error).message }));
    } finally {
      loading.current.delete(requestKey);
    }
  };
  useEffect(() => {
    setTopics({});
    setErrors({});
  }, [minimum]);
  useEffect(() => {
    const refresh = () => {
      if (publicMode && document.hidden) return;
      for (const key of expanded)
        if (key.startsWith("board:")) void load(key.split(":").pop()!);
    };
    refresh();
    const timer = setInterval(refresh, publicMode ? 60_000 : 4000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [[...expanded].join("|"), minimum, publicMode]);
  const visibleBoards = boards.filter(
    (b) =>
      (b.videoCount || 0) > 0 ||
      (!minimum && b.video && b.indexState !== "complete"),
  );
  const categoryCounts = new Map<string, number>();
  for (const b of visibleBoards) {
    const matches =
      !query ||
      `${b.id} ${b.name} ${b.category}`
        .toLowerCase()
        .includes(query.toLowerCase()) ||
      topics[b.id]?.some((t) =>
        t.title.toLowerCase().includes(query.toLowerCase()),
      );
    if (matches)
      categoryCounts.set(
        b.category,
        (categoryCounts.get(b.category) || 0) + (b.videoCount || 0),
      );
  }
  const categories = [...categoryCounts.keys()].sort(
    (a, b) =>
      (categoryCounts.get(b) || 0) - (categoryCounts.get(a) || 0) ||
      a.localeCompare(b, "ru"),
  );
  const row = (
    source: Source,
    level: number,
    children: boolean,
    action: () => void,
    detail: string,
    playable = true,
    indexState: Board["indexState"] = "pending",
  ) => {
    const key = sourceKey(source),
      active = sourceKey(selected) === key,
      added = basket.some((s) => sourceKey(s) === key);
    const thread =
      source.kind === "thread"
        ? { board: source.board!, thread: source.id, title: source.label }
        : undefined;
    const excluded =
      !!thread &&
      excludedThreads.some((t) => threadKey(t) === threadKey(thread));
    return (
      <div
        className={`tree-row ${excluded ? "thread-excluded" : ""} ${active ? "active" : ""} ${!playable ? "unindexed" : ""}`}
        style={{ paddingLeft: 12 + level * 14 }}
        key={key}
      >
        {thread && (
          <details
            className="thread-menu"
            name="thread-actions"
            onToggle={(e) => {
              const menu = e.currentTarget;
              if (!menu.open) return;
              const trigger = menu
                .querySelector("summary")!
                .getBoundingClientRect();
              const bounds = menu
                .closest(".tree-scroller")!
                .getBoundingClientRect();
              menu.dataset.above = String(
                trigger.bottom + 96 >
                  Math.min(bounds.bottom, window.innerHeight),
              );
              menu.style.setProperty(
                "--thread-menu-width",
                `${Math.min(214, bounds.right - trigger.left - 8)}px`,
              );
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                e.currentTarget.open = false;
                e.currentTarget.querySelector("summary")?.focus();
              }
            }}
          >
            <summary aria-label={`Действия треда ${source.label}`}>
              <EllipsisVertical size={14} />
            </summary>
            <div>
              <button
                onClick={(e) => {
                  e.currentTarget.closest("details")!.open = false;
                  excluded ? restoreThread(thread) : excludeThread(thread);
                }}
              >
                {excluded ? "Вернуть в мой эфир" : "Исключить из моего эфира"}
              </button>
              <button
                onClick={(e) => {
                  e.currentTarget.closest("details")!.open = false;
                  toggle(source);
                }}
              >
                {added ? "Убрать из подборки" : "Добавить в подборку"}
              </button>
            </div>
          </details>
        )}
        {!thread &&
          (children ? (
            <button
              className="disclosure"
              aria-label={`Раскрыть ${source.label}`}
              aria-expanded={expanded.has(key)}
              onClick={action}
            >
              <ChevronRight
                size={14}
                className={expanded.has(key) ? "rotated" : ""}
              />
            </button>
          ) : (
            <span className="leaf-dot" />
          ))}
        <button
          className="tree-label"
          title={source.label}
          disabled={excluded || (!playable && !children)}
          onClick={() => (playable ? select(source) : action())}
        >
          {source.label}
          <small>
            {excluded ? "Исключён из моего эфира" : detail}
            <span
              className="tree-index-status"
              role="img"
              aria-label={
                indexState === "complete"
                  ? "Полностью проверено"
                  : indexState === "error"
                    ? "Не удалось завершить проверку"
                    : "Проверка ещё не завершена"
              }
              title={
                indexState === "complete"
                  ? "Все треды проверены"
                  : indexState === "error"
                    ? "Есть ошибки проверки — повторим позже"
                    : "Количество видео ещё пополняется"
              }
            >
              {indexState === "complete" ? (
                <Check size={11} />
              ) : indexState === "error" ? (
                <CircleAlert size={11} />
              ) : (
                <LoaderCircle className="spin" size={11} />
              )}
            </span>
          </small>
        </button>
        {playable && !thread && (
          <button
            className={`add-source ${added ? "added" : ""}`}
            aria-label={`${added ? "Убрать" : "Добавить"} ${source.label} ${added ? "из" : "в"} подборку`}
            onClick={() => toggle(source)}
          >
            {added ? <Check size={13} /> : <Plus size={13} />}
          </button>
        )}
      </div>
    );
  };
  return (
    <>
      <div className="tree-search">
        <Search size={15} />
        <input
          aria-label="Поиск досок и открытых тредов"
          placeholder="Найти тему"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <button
        className={`root-channel ${selected.kind === "root" ? "active" : ""}`}
        onClick={() => select({ kind: "root", id: "all", label: "Весь Двач" })}
      >
        <Radio size={18} />
        Весь Двач<span>Вперемешку</span>
      </button>
      <div className="tree-scroller">
        {!visibleBoards.length && (
          <div className="tree-note">
            <LoaderCircle className="spin" size={15} />
            {minimum
              ? "Ищем видео выбранной длительности…"
              : "Ищем первые видео…"}
          </div>
        )}
        {categories.map((category) => {
          const cat: Source = {
            kind: "category",
            id: category,
            label: category === "Взрослым" ? "18+" : category,
          };
          const catKey = sourceKey(cat);
          const visible = visibleBoards.filter(
            (b) =>
              b.category === category &&
              (!query ||
                `${b.id} ${b.name} ${category}`
                  .toLowerCase()
                  .includes(query.toLowerCase()) ||
                topics[b.id]?.some((t) =>
                  t.title.toLowerCase().includes(query.toLowerCase()),
                )),
          );
          if (!visible.length) return null;
          const count = visible.reduce((n, b) => n + (b.videoCount || 0), 0);
          return (
            <div key={category}>
              {row(
                cat,
                0,
                true,
                () => expand(catKey),
                count ? `${count} видео` : "Проверяем доски",
                true,
                boards
                  .filter(
                    (b) =>
                      b.category === category && (b.video || !!b.videoCount),
                  )
                  .some((b) => b.indexState === "error")
                  ? "error"
                  : boards
                        .filter(
                          (b) =>
                            b.category === category &&
                            (b.video || !!b.videoCount),
                        )
                        .every((b) => b.indexState === "complete")
                    ? "complete"
                    : "pending",
              )}
              {(expanded.has(catKey) || !!query) && (
                <div>
                  {visible
                    .sort(
                      (a, b) =>
                        (b.videoCount || 0) - (a.videoCount || 0) ||
                        a.name.localeCompare(b.name, "ru") ||
                        a.id.localeCompare(b.id),
                    )
                    .map((b) => {
                      const s: Source = {
                          kind: "board",
                          id: b.id,
                          label: b.name,
                        },
                        key = sourceKey(s);
                      const list = topics[b.id];
                      return (
                        <div key={b.id}>
                          {row(
                            s,
                            1,
                            true,
                            () => {
                              expand(key);
                              void load(b.id);
                            },
                            `/${b.id}/ · ${b.videoCount ? b.videoCount + " видео" : b.videoState === "empty" ? "без видео" : "проверяем"}`,
                            true,
                            b.indexState,
                          )}
                          {(expanded.has(key) ||
                            (!!query &&
                              list?.some((t) =>
                                t.title
                                  .toLowerCase()
                                  .includes(query.toLowerCase()),
                              ))) && (
                            <div className="topics">
                              {errors[b.id] && (
                                <button
                                  className="tree-note error"
                                  onClick={() => void load(b.id)}
                                >
                                  Не удалось проверить · повторить
                                </button>
                              )}
                              {!list && (
                                <div className="tree-note">
                                  <LoaderCircle className="spin" size={13} />
                                  Проверяем треды…
                                </div>
                              )}
                              {list
                                ?.filter(
                                  (t) =>
                                    (!!t.videoCount ||
                                      (!minimum &&
                                        t.indexState !== "complete")) &&
                                    (!query ||
                                      `${b.name} ${b.id} ${t.title}`
                                        .toLowerCase()
                                        .includes(query.toLowerCase())),
                                )
                                .sort(
                                  (a, b) =>
                                    (b.videoCount || 0) - (a.videoCount || 0) ||
                                    a.title.localeCompare(b.title, "ru") ||
                                    a.id.localeCompare(b.id),
                                )
                                .map((t) =>
                                  row(
                                    {
                                      kind: "thread",
                                      id: t.id,
                                      board: b.id,
                                      label: t.title,
                                    },
                                    2,
                                    false,
                                    () => {},
                                    t.videoCount
                                      ? `${t.videoCount} видео`
                                      : t.videoState === "empty"
                                        ? "без видео"
                                        : "ещё проверяем",
                                    true,
                                    t.indexState,
                                  ),
                                )}
                              {list &&
                                list.every((t) => t.videoState === "empty") && (
                                  <div className="tree-note">
                                    В этой доске видео не найдено
                                  </div>
                                )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="sidebar-bottom">
        <label className="adult-toggle">
          <input
            type="checkbox"
            checked={includeAdult}
            onChange={(e) => setAdult(e.target.checked)}
          />
          Включать 18+ в общий эфир
        </label>
        {collections.length > 0 && (
          <>
            <div className="section-label">МОИ ПОДБОРКИ</div>
            {collections.map((c) => (
              <button
                className="collection-link"
                key={c.id}
                onClick={() => openCollection(c)}
              >
                <Folder size={15} />
                {c.name}
              </button>
            ))}
          </>
        )}
        <div className="sidebar-hint">
          <Layers size={14} />
          {boards.filter((b) => b.videoCount).length} досок с найденными видео
        </div>
      </div>
    </>
  );
}
