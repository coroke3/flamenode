import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { eq, sql } from "drizzle-orm";
import styles from "./page.module.css";
import { signIn } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDatabase } from "@/lib/cloudflare";
import { fetchActiveEvents } from "@/lib/db/queries";
import { slots as slotsTable } from "@/lib/db/schema";
import { isAcceptingEntries } from "@/lib/utils/eventStatus";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import { AppShell } from "@/components/ui/AppShell";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { sanitizeNextPath } from "@/lib/utils/next";

export const metadata: Metadata = { title: "エントリー" };
export const dynamic = "force-dynamic";

export default async function EntryPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const next = sanitizeNextPath(params?.next, "/entry");
  // 失敗時は null として扱う。getCurrentUser は内部で auth().catch を行うため
  // ここで try/catch する必要はない。
  const sessionUser = await getCurrentUser();
  const isLoggedIn = !!sessionUser?.id;
  // 書き込みガードは is_tos_accepted !== 1 (および terms_reaccept_required === 1) で
  // tos_required / tos_reaccept_required を返す。ここでも同じ条件を見て CTA 出す。
  const needsTosAccept =
    !!sessionUser &&
    (sessionUser.is_tos_accepted !== 1 ||
      sessionUser.terms_reaccept_required === 1);

  const db = getDatabase();
  const activeEventsRaw = db ? await fetchActiveEvents(db).catch(() => []) : [];
  // 開催前でも受付 OPEN のイベントは募集対象にする。
  // 複数並走時の優先度: 募集終了が近いものを先頭に、未設定は最後尾に回し、その中で start_time 昇順。
  const activeEvents = activeEventsRaw
    .filter((ev) => isAcceptingEntries(ev))
    .sort((a, b) => {
      const aEnd = a.entry_end_time ?? Number.POSITIVE_INFINITY;
      const bEnd = b.entry_end_time ?? Number.POSITIVE_INFINITY;
      if (aEnd !== bEnd) return aEnd - bEnd;
      return (a.start_time ?? 0) - (b.start_time ?? 0);
    });
  const slotCounts = new Map<string, number>();
  if (db && activeEvents.length > 0) {
    const rows = await db
      .select({
        event_id: slotsTable.event_id,
        count: sql<number>`COUNT(*)`,
      })
      .from(slotsTable)
      .where(eq(slotsTable.status, "available"))
      .groupBy(slotsTable.event_id);
    rows.forEach((row) => slotCounts.set(row.event_id, Number(row.count ?? 0)));
  }

  return (
    <AppShell size="default">
      <header className="fn-page-head">
        <div className="fn-page-head-main">
          <p className="fn-eyebrow">Entry</p>
          <h1 className="fn-page-title fn-page-title--compact">何をしますか？</h1>
          <p className="fn-page-lead">
            イベント参加か、過去作品の投稿を選んでください。
          </p>
        </div>
      </header>

      {!isLoggedIn ? (
        <section className={styles.loginSection} aria-labelledby="login-card">
          <h2 id="login-card" className={styles.cardTitle}>
            まず Discord でログインしてください
          </h2>
          <p className={styles.cardLead}>
            参加・投稿にはログインが必要です。連携時に取得した
            <code> access_token </code>
            は保存しません。
          </p>
          <form
            action={async () => {
              "use server";
              await signIn("discord", { redirectTo: next });
            }}
            className={styles.btnRow}
          >
            <button type="submit" className="fn-btn fn-btn-primary">
              <Icon name="discord" size={14} aria-hidden />
              Discord でログイン
            </button>
          </form>
          {next !== "/entry" ? (
            <p className={styles.tosNote}>
              ログイン後、元のページへ戻ります。
            </p>
          ) : null}
          <p className={styles.tosNote}>
            ログイン後、枠確保や投稿などの書き込み操作を行う前に、
            最新の <Link href="/rules">利用規約</Link>への同意をお願いする場合があります。
          </p>
        </section>
      ) : needsTosAccept ? (
        <StatusPanel
          title={
            sessionUser?.terms_reaccept_required === 1
              ? "利用規約の再同意が必要です"
              : "利用規約への同意が必要です"
          }
          tone="warning"
          action={
            <Link
              href={`/rules?next=${encodeURIComponent(next)}`}
              className="fn-btn fn-btn-primary"
            >
              利用規約を確認する
            </Link>
          }
        >
          {sessionUser?.terms_reaccept_required === 1
            ? "利用規約の改訂がありました。書き込み操作の前に最新の規約に再同意してください。"
            : "書き込み操作 (枠確保・投稿・いいね等) の前に、最新の利用規約への同意が必要です。"}
        </StatusPanel>
      ) : (
        <StatusPanel title="現在の操作状態" tone="success">
          ログイン済み
          {sessionUser?.active_x_user_id
            ? ` / Active X ID: @${sessionUser.active_x_user_id}`
            : " / Active X ID未選択"}
        </StatusPanel>
      )}

      <div className={styles.choiceGrid}>
        {/* カード1: イベントに参加する */}
        <section className={styles.choiceCard} aria-labelledby="join-event-card">
          <h2 id="join-event-card" className={styles.cardTitle}>
            <Icon name="calendar" size={16} aria-hidden />
            イベントに参加する
          </h2>
          <p className={styles.cardLead}>
            開催中のイベントのスロットを確保して、作品を投稿できます。
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
                  href={`/event/${ev.id}/slots`}
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
                    残り {slotCounts.get(ev.id) ?? 0} 枠
                    {ev.explanation ? ` / ${ev.explanation.slice(0, 60)}` : ""}
                  </span>
                  <span className={styles.eventCardMeta}>
                    {formatUnix(ev.start_time, { dateOnly: true })}
                    {ev.end_time
                      ? ` 〜 ${formatUnix(ev.end_time, { dateOnly: true })}`
                      : ""}
                    {isAcceptingEntries(ev) ? " · 受付中" : ""}
                  </span>
                  {ev.entry_end_time != null ? (
                    <span className={styles.eventCardMeta}>
                      募集終了: {formatUnix(ev.entry_end_time)}
                    </span>
                  ) : null}
                </Link>
              ))
            )}
          </div>
          {isLoggedIn && activeEvents.length === 1 ? (
            <div className={styles.btnRow} style={{ marginTop: 12 }}>
              <Link href={`/event/${activeEvents[0].id}/slots`} className="fn-btn fn-btn-primary">
                <Icon name="calendar" size={14} aria-hidden />
                スロットを確保する
              </Link>
            </div>
          ) : isLoggedIn && activeEvents.length > 1 ? (
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: 12,
                marginTop: 12,
              }}
            >
              参加するイベントを上の一覧から選択してください (募集終了が近い順)。
            </p>
          ) : null}
        </section>

        {/* カード2: 過去の作品を投稿する */}
        <section
          className={styles.choiceCard}
          aria-labelledby="post-unslotted-card"
        >
          <h2 id="post-unslotted-card" className={styles.cardTitle}>
            <Icon name="edit" size={16} aria-hidden />
            過去の自分の作品を投稿する
          </h2>
          <p className={styles.cardLead}>
            イベントの枠に関係なく、既存の作品をFlameNodeに登録できます。
            投稿には承認済みのX IDが必要です。
          </p>
          {isLoggedIn ? (
            <div className={styles.btnRow}>
              <Link href="/dashboard/post/unslotted" className="fn-btn fn-btn-ghost">
                <Icon name="edit" size={14} aria-hidden />
                作品を投稿する
              </Link>
            </div>
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
              ログイン後に投稿できます。
            </p>
          )}
        </section>
      </div>
    </AppShell>
  );
}
