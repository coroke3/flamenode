import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import styles from "./page.module.css";
import { auth, signIn } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { fetchActiveEvents } from "@/lib/db/queries";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";

export const metadata: Metadata = { title: "エントリー" };
export const dynamic = "force-dynamic";

export default async function EntryPage(): Promise<React.ReactElement> {
  const session = await auth().catch(() => null);
  const db = getDatabase();
  const activeEvents = db ? await fetchActiveEvents(db).catch(() => []) : [];

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1 className={styles.title}>FlameNode へようこそ</h1>
        <p className={styles.lead}>
          Discord でログインして、作品の投稿、いいね、ブックマーク、コメント、イベント参加ができます。
        </p>
      </header>

      <div className={styles.layout}>
        {!session?.user ? (
          <section className={styles.card} aria-labelledby="login-card">
            <h2 id="login-card" className={styles.cardTitle}>
              ログイン
            </h2>
            <p className={styles.cardLead}>
              Discord アカウントで認証します。連携時に取得した
              <code> access_token </code>
              は保存しないため、必要なときに毎回 OAuth が走ります。
            </p>
            <form
              action={async () => {
                "use server";
                await signIn("discord", { redirectTo: "/dashboard" });
              }}
              className={styles.btnRow}
            >
              <button type="submit" className="fn-btn fn-btn-primary">
                <Icon name="discord" size={14} aria-hidden />
                Discord でログイン
              </button>
            </form>
            <p
              style={{
                marginTop: 14,
                color: "var(--text-muted)",
                fontSize: 11.5,
              }}
            >
              ログインすることで、最新の <Link href="/rules">利用規約</Link>に同意したものとみなされます。
            </p>
          </section>
        ) : (
          <section className={styles.card} aria-labelledby="welcome-card">
            <h2 id="welcome-card" className={styles.cardTitle}>
              ようこそ {session.user.name ?? "ゲスト"} さん
            </h2>
            <p className={styles.cardLead}>
              すでにログイン済みです。下の導線から、ダッシュボードや投稿画面に移動できます。
            </p>
            <div className={styles.btnRow}>
              <Link href="/dashboard" className="fn-btn fn-btn-primary">
                <Icon name="grid" size={14} aria-hidden />
                ダッシュボード
              </Link>
              <Link href="/dashboard/post" className="fn-btn fn-btn-ghost">
                <Icon name="edit" size={14} aria-hidden />
                作品を投稿する
              </Link>
            </div>
          </section>
        )}

        <section className={styles.card} aria-labelledby="event-card">
          <h2 id="event-card" className={styles.cardTitle}>
            参加可能なイベント
          </h2>
          <p className={styles.cardLead}>
            応募受付中のイベントは、ログイン後にスロットを確保できます。
          </p>
          <div className={styles.eventList}>
            {activeEvents.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
                現在受付中のイベントはありません。
              </p>
            ) : (
              activeEvents.map((ev) => (
                <Link
                  key={ev.id}
                  href={`/event/${ev.id}`}
                  className={styles.eventCard}
                  style={
                    ev.accent_color
                      ? ({
                          ["--event-accent" as never]: ev.accent_color,
                        } as React.CSSProperties)
                      : undefined
                  }
                >
                  <span className={styles.eventCardTitle}>{ev.title}</span>
                  <span className={styles.eventCardMeta}>
                    {formatUnix(ev.start_time, { dateOnly: true })}
                    {ev.end_time
                      ? ` 〜 ${formatUnix(ev.end_time, { dateOnly: true })}`
                      : ""}
                    {ev.is_entry_open === 1 ? " · 受付中" : ""}
                  </span>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
