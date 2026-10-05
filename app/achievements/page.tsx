"use client";

import { useMemo } from "react";
import { Icon } from "@/components/Icon";
import { useMediaMetas } from "@/components/media/useMedia";
import { allMediaIds, computeAchievements } from "@/lib/achievements";
import { routes } from "@/lib/routes";
import { useTrips } from "@/lib/useTrips";
import { useUserData } from "@/lib/userdata";
import { BackLink } from "@/components/BackLink";

/** Достижения — по реальным моментам, поездкам, километрам и фото. */
export default function AchievementsPage() {
  const { trips } = useTrips();
  const { data } = useUserData();
  const ids = useMemo(() => allMediaIds(trips ?? []), [trips]);
  const metas = useMediaMetas(ids);
  const list = useMemo(() => computeAchievements(trips ?? [], metas, data), [trips, metas, data]);
  const done = list.filter((a) => a.done);
  const open = list.filter((a) => !a.done).sort((a, b) => b.value / b.goal - a.value / a.goal);
  return (
    <main className="shell achPage">
      <header className="nmHead">
        <BackLink href={routes.me} className="iconBtnPlain">
          <Icon name="back" />
        </BackLink>
        <h1>Достижения</h1>
        <span style={{ width: 40 }} />
      </header>
      {trips === null ? (
        <p className="muted">Загрузка…</p>
      ) : (
        <>
          <p className="achSummary">
            Получено <b>{done.length}</b> из {list.length}
          </p>
          <div className="achGrid">
            {[...done, ...open].map((a) => (
              <div key={a.id} className={`achItem ${a.done ? "done" : ""}`}>
                <span className="achIcon">{a.icon}</span>
                <strong>{a.title}</strong>
                <span className="muted small">{a.text}</span>
                {!a.done && (
                  <span className="achBar">
                    <i style={{ width: `${(a.value / a.goal) * 100}%` }} />
                    <em>
                      {a.value.toLocaleString("ru-RU")} / {a.goal.toLocaleString("ru-RU")}
                    </em>
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
