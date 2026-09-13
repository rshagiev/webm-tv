import { useEffect, useRef, useState } from "react";
import { Info, Power, X, Copy, Check } from "lucide-react";
import { api } from "./api";

type SystemInfo = {
  public?: boolean;
  url?: string;
  version: string;
  localhost: string;
  lan: string[];
  shutdownToken: string;
};
export function SystemControls({
  onStopped,
  publicMode = false,
}: {
  onStopped: () => void;
  publicMode?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [panel, setPanel] = useState<"info" | "power" | null>(null);
  const [info, setInfo] = useState<SystemInfo>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [copied, setCopied] = useState("");
  useEffect(() => {
    if (!panel) {
      dialog.current?.close();
      return;
    }
    dialog.current?.showModal();
    let alive = true;
    setError("");
    setInfo(undefined);
    api<SystemInfo>("/system")
      .then((d) => {
        if (alive) setInfo(d);
      })
      .catch(() => {
        if (alive)
          setError("Нет связи с сервером. Откройте файл запуска WebM TV.");
      });
    return () => {
      alive = false;
    };
  }, [panel]);
  async function stop() {
    if (!info || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/shutdown", {
        method: "POST",
        headers: { "X-WebMTV-Shutdown": info.shutdownToken },
      });
      setStopped(true);
      onStopped();
    } catch {
      setError(
        "Не удалось подтвердить выключение. Проверьте соединение и повторите.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
    } catch {
      setError("Выделите адрес и скопируйте его вручную.");
    }
  }
  return (
    <>
      <div className="system-controls">
        <button
          aria-label="Информация и адреса"
          title="Информация и адреса"
          onClick={() => setPanel("info")}
        >
          <Info size={18} />
        </button>
        {!publicMode && (
          <button
            aria-label="Выключить WebM TV"
            title="Выключить WebM TV"
            onClick={() => setPanel("power")}
          >
            <Power size={18} />
          </button>
        )}
      </div>
      <dialog
        ref={dialog}
        className="system-dialog"
        onKeyDown={(e) => e.stopPropagation()}
        onCancel={(e) => {
          if (stopped || busy) e.preventDefault();
          else setPanel(null);
        }}
        onClose={() => {
          if (!stopped) setPanel(null);
        }}
      >
        <header>
          <h2>
            {stopped
              ? "WebM TV выключен"
              : panel === "power"
                ? "Выключить WebM TV?"
                : "WebM TV"}
          </h2>
          {!stopped && (
            <button
              aria-label="Закрыть информацию"
              disabled={busy}
              onClick={() => setPanel(null)}
            >
              <X size={20} />
            </button>
          )}
        </header>
        {stopped ? (
          <>
            <p>Сервер остановлен. Эту вкладку можно закрыть.</p>
            <p>
              Чтобы смотреть снова, откройте <strong>WebM TV.app</strong> на Mac
              или <strong>Start.vbs</strong> на Windows в папке приложения.
            </p>
          </>
        ) : panel === "power" ? (
          <>
            <p>
              Просмотр остановится на компьютере и подключённых телефонах.
              Настройки и закладки сохранятся.
            </p>
            <button
              className="power-confirm"
              disabled={!info || busy}
              onClick={stop}
            >
              <Power size={17} />
              {busy ? "Выключаем…" : "Выключить"}
            </button>
          </>
        ) : (
          <>
            <p className="system-version">Версия {info?.version || "…"}</p>
            {info?.public ? (
              <>
                <label>Адрес сайта</label>
                <Address url={info.url!} />
                <p>Настройки и история просмотров хранятся в вашем браузере.</p>
                <a href="https://github.com/rshagiev/webm-tv">
                  Исходный код · запустить у себя
                </a>
              </>
            ) : (
              <>
                <label>На этом компьютере</label>
                {info && <Address url={info.localhost} />}
                <label>На телефоне в той же Wi-Fi сети</label>
                {info?.lan.map((url) => (
                  <Address key={url} url={url} />
                ))}
                {info && !info.lan.length && (
                  <p>Адрес локальной сети недоступен.</p>
                )}
                <p>
                  На телефоне откройте адрес Wi-Fi/Ethernet. Если адресов
                  несколько, не выбирайте VPN. Компьютер должен оставаться
                  включённым; окно терминала не требуется при запуске через
                  приложение.
                </p>
              </>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </dialog>
    </>
  );
  function Address({ url }: { url: string }) {
    return (
      <div className="system-address">
        <a href={url}>{url}</a>
        <button aria-label={`Скопировать ${url}`} onClick={() => copy(url)}>
          {copied === url ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
    );
  }
}
