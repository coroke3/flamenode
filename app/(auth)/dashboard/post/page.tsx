import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, eq, isNull, or } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  slots as slotsTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guard";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import { collapseReservationGroups, type SlotBase } from "@/lib/utils/slotGrouping";

export const metadata: Metadata = { title: "投稿方法を選択" };
export const dynamic = "force-dynamic";

type ReservedSlot = {
  id: string;
  event_id: string;
  video_id: string | null;
  slot_kind: "time" | "count" | null;
  slot_label: string | null;
  start_time: number | null;
  end_time: number | null;
  sort_order: number | null;
  status: "available" | "reserved" | "submitted";
  discord_user_id: string | null;
  x_user_id: string | null;
  display_name: string | null;
  reservation_group_id: string | null;
  priority_reclaim_until: number | null;
  priority_reclaim_video_id: string | null;
  updated_at: number;
  event_title: string | null;
};

export default async function PostChooserPage(): Promise<React.ReactElement> {
  const guard = await requireSession({ next: "/dashboard/post" });
  if (!guard.ok) return guard.element;
  const db = getDatabase();
  const activeX = guard.user.active_x_user_id ?? null;
  let reservedSlots: ReservedSlot[] = [];
  let activeXApprovalStatus: "approved" | "pending" | "rejected" | null = null;
  if (db && activeX) {
    const xRow = (
      await db
        .select({ approval_status: xUsersTable.approval_status })
        .from(xUsersTable)
        .where(eq(xUsersTable.id, activeX))
        .limit(1)
    )[0];
    activeXApprovalStatus = xRow?.approval_status ?? null;
  }

  if (db) {
    const ownerWhere = activeX
      ? or(
          eq(slotsTable.x_user_id, activeX),
          and(isNull(slotsTable.x_user_id), eq(slotsTable.discord_user_id, guard.user.id))!,
        )
      : eq(slotsTable.discord_user_id, guard.user.id);
    reservedSlots = await db
      .select({
        id: slotsTable.id,
        event_id: slotsTable.event_id,
        video_id: slotsTable.video_id,
        slot_kind: slotsTable.slot_kind,
        slot_label: slotsTable.slot_label,
        start_time: slotsTable.start_time,
        end_time: slotsTable.end_time,
        sort_order: slotsTable.sort_order,
        status: slotsTable.status,
        discord_user_id: slotsTable.discord_user_id,
        x_user_id: slotsTable.x_user_id,
        display_name: slotsTable.display_name,
        reservation_group_id: slotsTable.reservation_group_id,
        priority_reclaim_until: slotsTable.priority_reclaim_until,
        priority_reclaim_video_id: slotsTable.priority_reclaim_video_id,
        updated_at: slotsTable.updated_at,
        event_title: eventsTable.title,
      })
      .from(slotsTable)
      .leftJoin(eventsTable, eq(slotsTable.event_id, eventsTable.id))
      .where(
        and(
          ownerWhere,
          or(eq(slotsTable.status, "reserved"), eq(slotsTable.status, "submitted"))!,
        )!,
      )
      .orderBy(slotsTable.start_time, slotsTable.end_time, slotsTable.sort_order)
      .limit(12);
  }

  const displaySlots = collapseReservationGroups(reservedSlots as SlotBase[]);
  const canPost = activeXApprovalStatus === "approved";
  const checkTitle = canPost ? "投稿前チェック" : "投稿には追加設定が必要です";
  const checkMessage = !activeX
    ? "投稿にはActive X IDの選択が必要です。設定画面から連携・選択してください。"
    : activeXApprovalStatus === "pending"
      ? "選択中のActive X IDは承認待ちです。承認後に投稿できます (枠の確保は可能)。"
      : activeXApprovalStatus === "rejected"
        ? "選択中のActive X IDは却下されています。設定画面で別のX IDを選択してください。"
        : activeXApprovalStatus === "approved"
          ? `投稿者X ID: @${activeX} (承認済) で投稿できます。`
          : "投稿には承認済みのActive X IDが必要です。設定画面で承認状態を確認してください。";

  return (
    <div className="fn-public-container fn-page fn-postchooser">
      <header className="fn-page-head">
        <Link href="/dashboard" className="fn-cp-back fn-mono">
          ← ダッシュボード
        </Link>
        <span className="fn-eyebrow">dashboard / post</span>
        <h1 className="fn-display fn-page-title">投稿方法を選択</h1>
        <p className="fn-jp fn-page-lead">
          イベント枠を確保している作品は枠あり提出から、通常の作品は枠なし投稿から進めます。
        </p>
      </header>

      <div
        className={`fn-pc-status-banner ${canPost ? "fn-pc-status-banner--ok" : ""}`}
        role="status"
      >
        <Icon name={canPost ? "check" : "alert"} size={18} aria-hidden />
        <div>
          <h3 className="fn-jp">{checkTitle}</h3>
          <p className="fn-jp fn-pc-banner-lead">{checkMessage}</p>
          {!canPost ? (
            <Link
              href={`/dashboard/settings?next=${encodeURIComponent("/dashboard/post")}`}
              className="fn-btn fn-btn-primary fn-btn-sm fn-mt-12"
            >
              X ID設定を確認
            </Link>
          ) : null}
        </div>
      </div>

      <div className="fn-pc-grid">
        <section className="fn-pc-card" aria-labelledby="post-slotted-heading">
          <div className="fn-pc-card-head">
            <span className="fn-pc-card-icon" aria-hidden>
              <Icon name="calendar" size={18} />
            </span>
            <div>
              <h2 id="post-slotted-heading" className="fn-pc-card-title">
                枠あり提出
              </h2>
              <p className="fn-jp fn-pc-card-lead">
                確保済みのイベント枠に作品情報を紐付けます。
              </p>
            </div>
          </div>

          {displaySlots.length === 0 ? (
            <div className="fn-pc-empty">
              <p className="fn-jp fn-pc-banner-lead">確保済み枠はありません。</p>
              <p className="fn-jp fn-pc-banner-lead">
                イベントに参加する場合は、まず空き枠を確保してください。
              </p>
              <Link href="/entry" className="fn-btn fn-btn-primary fn-btn-sm">
                枠を確保する
              </Link>
            </div>
          ) : (
            <ul className="fn-pc-slot-list">
              {displaySlots.map((slot) => (
                <li key={slot.id}>
                  <Link
                    href={`/dashboard/post/slotted?slot=${slot.id}`}
                    className="fn-pc-slot"
                  >
                    <span className="fn-pc-slot-info">
                      <span className="fn-pc-slot-label">
                        {slot.event_title ?? slot.event_id}
                      </span>
                      <span className="fn-mono fn-pc-slot-event">
                        {slot.start_time
                          ? `${formatUnix(slot.start_time, { dateOnly: true })} ${formatUnix(slot.start_time, { timeOnly: true })}${slot.end_time ? ` - ${formatUnix(slot.end_time, { timeOnly: true })}` : ""}`
                          : (slot.slot_label ?? "時間なし枠")}
                        {slot.is_group ? ` / ${slot.group_size}連続` : ""}
                      </span>
                    </span>
                    <Icon name="chevron-right" size={13} aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="fn-pc-card" aria-labelledby="post-unslotted-heading">
          <div className="fn-pc-card-head">
            <span className="fn-pc-card-icon" aria-hidden>
              <Icon name="edit" size={18} />
            </span>
            <div>
              <h2 id="post-unslotted-heading" className="fn-pc-card-title">
                枠なし投稿
              </h2>
              <p className="fn-jp fn-pc-card-lead">
                イベント枠に紐づかない作品を通常投稿として登録します。
              </p>
            </div>
          </div>
          <Link href="/dashboard/post/unslotted" className="fn-btn fn-btn-primary">
            <Icon name="edit" size={13} aria-hidden /> 枠なしで投稿する
          </Link>
        </section>
      </div>
    </div>
  );
}
