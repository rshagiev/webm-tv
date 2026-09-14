import { useEffect, useState } from "react";
import { api } from "./api";

type Summary = {
  startedAt: string;
  online: number;
  today: { date: string; browsers: number; watchSeconds: number };
};
export function AudienceStats() {
  const [stats, setStats] = useState<Summary>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<Summary>("/audience", { cache: "no-store" })
        .then((value) => {
          if (alive) {
            setStats(value);
            setFailed(false);
          }
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
    void load();
    const timer = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const minutes = Math.floor((stats?.today.watchSeconds || 0) / 60);
  return (
    <section className="audience-stats" aria-label="Статистика зрителей">
      <label>Зрители</label>
      {failed ? (
        <p>Статистика временно недоступна.</p>
      ) : !stats ? (
        <p>Загрузка статистики…</p>
      ) : (
        <>
          <dl>
            <div>
              <dt>Онлайн</dt>
              <dd>{stats.online.toLocaleString("ru-RU")}</dd>
            </div>
            <div>
              <dt>Браузеров сегодня</dt>
              <dd>{stats.today.browsers.toLocaleString("ru-RU")}</dd>
            </div>
            <div>
              <dt>Просмотр сегодня</dt>
              <dd>
                {minutes < 60
                  ? `${minutes} мин`
                  : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`}
              </dd>
            </div>
          </dl>
          <p>
            Онлайн — видимые вкладки за последнюю минуту. Сутки по UTC. Сбор с{" "}
            {new Date(stats.startedAt).toLocaleDateString("ru-RU", {
              timeZone: "UTC",
            })}
            .
          </p>
        </>
      )}
      <p>
        Анонимный счётчик использует случайный код браузера на сутки. IP-адреса
        и названия роликов не сохраняются. Время просмотра приблизительное;
        разные браузеры и сброс данных считаются отдельно.
      </p>
    </section>
  );
}
