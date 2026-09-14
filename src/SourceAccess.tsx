import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  Radio,
  Users,
  X,
} from "lucide-react";
import { api } from "./api";
type Status = {
  status: "ready" | "needs-help" | "source-unavailable";
  helping: boolean;
  retryAt: number;
};
type Attempt = {
  token: string;
  phase: "captcha" | "solved" | "submitted" | "uncertain" | "verified";
  expiresAt: number;
  image?: string;
  keyboard?: string[];
  threadUrl: string;
  postUrl?: string;
};
const storageKey = "webmtv-source-recovery";
export function SourceAccess({
  initialOpen = false,
}: {
  initialOpen?: boolean;
}) {
  const [status, setStatus] = useState<Status>();
  const [attempt, setAttempt] = useState<Attempt>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(initialOpen);
  const [now, setNow] = useState(Date.now());
  const refresh = () =>
    api<Status>("/source-access")
      .then((next) => {
        setStatus(next);
        if (next.status === "needs-help")
          setAttempt((a) => (a?.phase === "verified" ? undefined : a));
      })
      .catch(() =>
        setError("Не удалось связаться с сервером. Попробуйте ещё раз."),
      );
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 60_000);
    try {
      const token = sessionStorage.getItem(storageKey);
      if (token)
        void api<Attempt>("/source-access/resume", {
          method: "POST",
          headers: { "X-WebMTV-Action": "recover", "X-Recovery-Token": token },
        })
          .then(setAttempt)
          .catch(() => sessionStorage.removeItem(storageKey));
    } catch {}
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      clearInterval(clock);
    };
  }, []);
  const action = async (name: string, index?: number) => {
    if (busy) return;
    setBusy(true);
    setError("");
    if (name === "submit" && attempt)
      setAttempt({ ...attempt, phase: "submitted" });
    try {
      const next = await api<Attempt>("/source-access/" + name, {
        method: "POST",
        headers: {
          "X-WebMTV-Action": "recover",
          ...(attempt ? { "X-Recovery-Token": attempt.token } : {}),
        },
        ...(index === undefined ? {} : { body: JSON.stringify({ index }) }),
      });
      setAttempt(next);
      try {
        sessionStorage.setItem(storageKey, next.token);
      } catch {}
      if (next.phase === "verified") void refresh();
    } catch (e) {
      setError((e as Error).message);
      if (name === "submit")
        setAttempt((a) => a && { ...a, phase: "uncertain" });
    } finally {
      setBusy(false);
    }
  };
  const success = status?.status === "ready";
  const expired = !!attempt && now > attempt.expiresAt && !success;
  const waiting =
    !attempt && !!status && (status.helping || status.retryAt > now);
  const close = () => {
    if (initialOpen) location.assign("/");
    else setOpen(false);
  };
  const reset = () => {
    setAttempt(undefined);
    setError("");
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
    void refresh();
  };
  if (!open && (!status || status.status === "ready")) return null;
  if (!open)
    return (
      <aside className="source-notice">
        <Users size={18} aria-hidden="true" />
        <p>
          {status?.status === "source-unavailable"
            ? "Двач сейчас недоступен. Проверим снова позже."
            : "Закрытым доскам нужна ваша помощь."}
        </p>
        {status?.status === "needs-help" && (
          <button onClick={() => setOpen(true)}>
            Восстановить доступ <ArrowRight size={15} />
          </button>
        )}
      </aside>
    );
  const step = attempt?.phase === "captcha" ? 1 : attempt ? 2 : 0;
  return (
    <section
      className={`source-access${success ? " source-access-success" : ""}`}
      aria-label="Доступ к источнику"
      aria-busy={busy}
    >
      {!initialOpen && (
        <button
          className="access-dismiss"
          aria-label="Закрыть"
          disabled={busy}
          onClick={close}
        >
          <X size={18} />
        </button>
      )}
      <div className="access-emblem" aria-hidden="true">
        {success ? <Check size={27} /> : <Users size={25} />}
      </div>
      <div className="access-eyebrow">
        {success ? "СНОВА В ЭФИРЕ" : "ПОМОЩЬ СООБЩЕСТВА"}
      </div>
      <h1>{success ? "Доступ открыт для всех" : "Вернём закрытые доски"}</h1>
      {success ? (
        <>
          <p className="access-lead">
            {attempt?.phase === "verified" ? "Спасибо за помощь! " : ""}Закрытые
            доски снова доступны. Можно возвращаться к просмотру.
          </p>
          <div className="access-result">
            <CheckCircle2 size={18} />
            <span>Доступ проверен сервером</span>
            <span className="access-live-dot" />
          </div>
          <button className="access-primary" onClick={close}>
            <Radio size={18} />
            Вернуться в эфир
            <ArrowRight size={17} />
          </button>
          <p className="access-footnote">
            Каждый смотрит своё. Доступ к источнику — общий.
          </p>
        </>
      ) : !status ? (
        <>
          <p className="access-lead">Проверяем доступ к источнику…</p>
          {error ? (
            <>
              <p className="access-error" role="alert">
                {error}
              </p>
              <button
                className="access-primary"
                onClick={() => {
                  setError("");
                  void refresh();
                }}
              >
                Повторить проверку
              </button>
            </>
          ) : (
            <LoaderCircle className="access-spinner" size={22} />
          )}
        </>
      ) : status.status === "source-unavailable" ? (
        <>
          <p className="access-lead">
            Двач сейчас не отвечает. Когда он вернётся, мы проверим доступ
            снова.
          </p>
          <button className="access-secondary" onClick={() => void refresh()}>
            Проверить ещё раз
          </button>
        </>
      ) : (
        <>
          <p className="access-lead">
            Одна капча и комментарий в тестовом разделе Двача помогут вернуть
            доступ всем зрителям WebM TV.
          </p>
          <ol className="access-steps" aria-label="Шаги восстановления">
            {["Капча", "Комментарий", "Эфир"].map((label, index) => (
              <li
                key={label}
                className={
                  index < step - 1
                    ? "done"
                    : index === Math.max(0, step - 1)
                      ? "current"
                      : ""
                }
              >
                <span>
                  {index < step - 1 ? <Check size={12} /> : index + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>
          <div className="access-task">
            {expired ? (
              <>
                <h2>Время попытки истекло</h2>
                <p>Для восстановления понадобится новая капча.</p>
                <button
                  className="access-primary"
                  disabled={busy}
                  onClick={reset}
                >
                  Начать заново
                  <ArrowRight size={16} />
                </button>
              </>
            ) : (
              <>
                {!attempt && (
                  <>
                    <h2>
                      {waiting ? "Кто-то уже помогает" : "Помочь может каждый"}
                    </h2>
                    <p>
                      {waiting
                        ? "Проверим результат автоматически. Если доступ не восстановится, здесь можно будет попробовать снова."
                        : "Решите капчу, затем подтвердите отправку одного комментария test. Доступ сохранится на общем сервере."}
                    </p>
                    <button
                      className="access-primary"
                      disabled={busy || waiting}
                      onClick={() => void action("start")}
                    >
                      {busy ? (
                        <LoaderCircle className="access-spinner" size={17} />
                      ) : (
                        <ArrowRight size={17} />
                      )}{" "}
                      {busy
                        ? "Получаем капчу…"
                        : waiting
                          ? "Ожидаем восстановления"
                          : "Помочь восстановить"}
                    </button>
                  </>
                )}
                {attempt?.phase === "captcha" && (
                  <>
                    <h2>Выберите символы с картинки</h2>
                    <p>
                      Нажимайте на соответствующие значки ниже. После выбора они
                      могут поменяться.
                    </p>
                    <div className="access-captcha-surface">
                      <img
                        className="source-captcha"
                        alt="Задание капчи Двача"
                        src={`data:image/png;base64,${attempt.image}`}
                      />
                      <div className="source-keyboard">
                        {attempt.keyboard?.map((icon, index) => (
                          <button
                            key={index}
                            aria-label={`Символ ${index + 1}`}
                            disabled={busy}
                            onClick={() => void action("click", index)}
                          >
                            <img alt="" src={`data:image/png;base64,${icon}`} />
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {attempt?.phase === "solved" && (
                  <>
                    <h2>
                      <CheckCircle2 size={18} />
                      Капча решена
                    </h2>
                    <p>
                      Остался один комментарий. Он будет опубликован на Дваче от
                      общей сессии сервера.
                    </p>
                    <div className="access-post">
                      <span>КОММЕНТАРИЙ</span>
                      <code>test</code>
                      <a
                        href={attempt.threadUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Тестовый тред Двача
                        <ExternalLink size={13} />
                      </a>
                    </div>
                    <button
                      className="access-primary"
                      disabled={busy}
                      onClick={() => void action("submit")}
                    >
                      Отправить test
                      <ArrowRight size={16} />
                    </button>
                  </>
                )}
                {attempt?.phase === "submitted" && (
                  <div className="access-pending">
                    <LoaderCircle className="access-spinner" size={24} />
                    <h2>Восстанавливаем доступ</h2>
                    <p>Отправляем комментарий и проверяем закрытые доски.</p>
                  </div>
                )}
                {attempt?.phase === "uncertain" && (
                  <>
                    <h2>Ждём подтверждения</h2>
                    <p>
                      Комментарий мог быть отправлен. Проверим доступ ещё раз,
                      без повторной публикации.
                    </p>
                    {attempt.postUrl && (
                      <a
                        className="access-post-link"
                        href={attempt.postUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Открыть комментарий
                        <ExternalLink size={13} />
                      </a>
                    )}
                    <button
                      className="access-primary"
                      disabled={busy}
                      onClick={() => void action("verify")}
                    >
                      {busy && (
                        <LoaderCircle className="access-spinner" size={17} />
                      )}
                      Проверить доступ
                    </button>
                  </>
                )}
              </>
            )}
            {error && (
              <p className="access-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <p className="access-footnote">
            <Users size={14} />
            Один помогает — смотрят все
          </p>
          <button className="access-back" disabled={busy} onClick={close}>
            <ArrowLeft size={14} />
            Вернуться к просмотру
          </button>
        </>
      )}
    </section>
  );
}
