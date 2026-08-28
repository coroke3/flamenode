"use client";

import * as React from "react";
import styles from "./page.module.css";

type AboutStatsValue = {
  publicVideos: number;
  creators: number;
  events: number;
};

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const ABOUT_STATS_FETCH_TIMEOUT_MS = 5_000;

function normalizeStats(value: unknown): AboutStatsValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const publicVideos = Number(row.publicVideos);
  const creators = Number(row.creators);
  const events = Number(row.events);
  if (
    !Number.isSafeInteger(publicVideos) ||
    !Number.isSafeInteger(creators) ||
    !Number.isSafeInteger(events) ||
    publicVideos < 0 ||
    creators < 0 ||
    events < 0
  ) {
    return null;
  }
  return { publicVideos, creators, events };
}

function formatCount(value: number): string {
  return value.toLocaleString("ja-JP");
}

export function AboutStats(): React.ReactElement | null {
  const [stats, setStats] = React.useState<AboutStatsValue | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let delayTimeoutId: number | null = null;
    let fetchTimeoutId: number | null = null;
    let idleId: number | null = null;
    const controller = new AbortController();
    const idleWindow = window as IdleWindow;

    const load = () => {
      if (cancelled) return;
      fetchTimeoutId = window.setTimeout(
        () => controller.abort(),
        ABOUT_STATS_FETCH_TIMEOUT_MS,
      );
      void fetch("/api/public/about-stats", {
        cache: "default",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) return null;
          const body = (await response.json()) as { stats?: unknown };
          return normalizeStats(body.stats);
        })
        .then((value) => {
          if (!cancelled && value) setStats(value);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          console.warn("[about-stats] client fetch failed", {
            error: error instanceof Error ? error.name : "unknown",
          });
        })
        .finally(() => {
          if (fetchTimeoutId != null) {
            window.clearTimeout(fetchTimeoutId);
            fetchTimeoutId = null;
          }
        });
    };

    if (idleWindow.requestIdleCallback) {
      idleId = idleWindow.requestIdleCallback(load, { timeout: 1500 });
    } else {
      delayTimeoutId = window.setTimeout(load, 500);
    }

    return () => {
      cancelled = true;
      controller.abort();
      if (idleId != null) idleWindow.cancelIdleCallback?.(idleId);
      if (delayTimeoutId != null) window.clearTimeout(delayTimeoutId);
      if (fetchTimeoutId != null) window.clearTimeout(fetchTimeoutId);
    };
  }, []);

  if (!stats) return null;

  const items = [
    {
      label: "公開作品",
      value: formatCount(stats.publicVideos),
      unit: "件",
      note: "動画ページ・作品棚・イベントから閲覧できます。",
    },
    {
      label: "クリエイター名義",
      value: formatCount(stats.creators),
      unit: "件",
      note: "X ID を公開名義として作品と紐づけます。",
    },
    {
      label: "イベント",
      value: formatCount(stats.events),
      unit: "件",
      note: "募集・公開・アーカイブの記録を扱います。",
    },
  ];

  return (
    <section
      className={`fn-public-container ${styles.statsBand}`}
      aria-label="FlameNode の現在"
    >
      <dl className={styles.statsGrid}>
        {items.map((item) => (
          <div key={item.label} className={styles.statItem}>
            <dt>{item.label}</dt>
            <dd>
              <strong>{item.value}</strong>
              <span>{item.unit}</span>
            </dd>
            <p>{item.note}</p>
          </div>
        ))}
      </dl>
    </section>
  );
}
