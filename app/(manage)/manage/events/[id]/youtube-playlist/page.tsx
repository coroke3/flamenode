import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import {
  canAccessManageEventFromSnapshot,
  canEditEventFromSnapshot,
  getManageStaffXUserIdsFromSnapshot,
  getManageAuthorizationSnapshot,
} from "@/lib/auth/manageAuthorization";
import { getManageNavigationSnapshot } from "@/lib/manage/navigationEvents";
import {
  eventYoutubePlaylistSync,
} from "@/lib/db/schema";
import {
  queueEventYoutubePlaylistSync,
  saveEventYoutubePlaylistSettings,
} from "@/lib/actions/event-youtube-playlist";
import { ManageEventPageShell } from "@/components/manage/ManageEventPageShell";
import { manageEventAccentStyle } from "@/lib/utils/eventAccent";
import { formatUnix } from "@/lib/utils/format";

export const metadata: Metadata = { title: "YouTube再生リスト同期" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ saved?: string; queued?: string; error?: string }>;
}

const STATUS_LABELS: Record<string, string> = {
  disabled: "無効",
  idle: "実行待ち",
  scanning: "再生リスト確認中",
  synced: "同期済み",
  deferred: "クォータ・分割処理待ち",
  failed: "同期失敗",
};

const SYNC_DETAIL_LABELS: Record<string, string> = {
  playlist_mutation_batch_continuing:
    "追加・削除の処理上限に達したため、次回へ継続します。",
  playlist_scan_continuing:
    "再生リストの全件確認を分割して続行しています。",
  playlist_stale_cleanup_continuing:
    "全件確認後の古い項目情報を分割して整理しています。",
  playlist_order_repair_continuing:
    "投稿枠順とのずれを少量ずつ自動補正しています。",
  playlist_order_repair_request_budget:
    "外部API呼び出し上限に達する前に停止し、次回へ順序補正を継続します。",
  playlist_order_repair_quota_deferred:
    "YouTube APIクォータの余裕が不足したため、既存項目の順序補正を後回しにしました。",
  playlist_order_repair_scan_limit_exceeded:
    "再生リストが大きく、安全に確認できる範囲を超えたため既存項目の自動並び替えを停止しました。",
  playlist_order_repair_ambiguous_remote_items:
    "YouTube側の対象動画に欠落・重複があり、安全な自動並び替えを確定できませんでした。",
  playlist_order_fallback_manual_sort_required:
    "YouTube側の並び順を「手動」にしてください。投稿枠位置への挿入・既存順序補正ができませんでした。",
  youtube_quota_budget_deferred:
    "YouTube APIの日次クォータ上限に近いため、次回へ繰り越しました。",
};

function syncDetailLabel(value: string | null | undefined): string {
  if (!value) return "なし";
  return SYNC_DETAIL_LABELS[value] ?? value;
}

function statusClass(status: string | null | undefined): string {
  if (status === "failed") return "fn-badge-danger";
  if (status === "deferred" || status === "scanning") return "fn-badge-warning";
  if (status === "synced") return "fn-badge-accent";
  return "fn-badge-soft";
}

export default async function EventYoutubePlaylistPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const guard = await requireSession({
    next: `/manage/events/${encodeURIComponent(id)}/youtube-playlist`,
  });
  if (!guard.ok) return guard.element;

  const db = getDatabase();
  if (!db) notFound();
  const authorization = await getManageAuthorizationSnapshot(
    guard.user.id,
    guard.user.role ?? null,
  );
  const navigation = await getManageNavigationSnapshot(
    guard.user.id,
    guard.user.role ?? null,
  );
  if (!canAccessManageEventFromSnapshot(authorization, id)) notFound();
  const ev = navigation.events.find((event) => event.id === id);
  if (!ev) notFound();

  const canEdit = canEditEventFromSnapshot(
    authorization,
    id,
    "event.publish",
  );
  const config = (
    await db
      .select()
      .from(eventYoutubePlaylistSync)
      .where(eq(eventYoutubePlaylistSync.event_id, id))
      .limit(1)
  )[0];
  const isAdmin = guard.user.role === "admin";
  const playlistId = config?.playlist_id ?? "";
  const mode = config?.sync_mode ?? "off";
  const interval = config?.sync_interval_minutes ?? 720;
  const pendingCount = navigation.pendingByEvent.get(ev.id) ?? 0;

  return (
    <ManageEventPageShell
      eventId={ev.id}
      title={ev.title}
      description="イベントの公開作品を、指定したYouTube再生リストへ差分同期します。"
      backHref={`/manage/events/${encodeURIComponent(ev.id)}`}
      backLabel="イベント概要へ"
      isAdmin={isAdmin}
      pendingCount={pendingCount}
      accentStyle={manageEventAccentStyle(ev.accent_color)}
      showActiveXNotice
      activeXUserId={guard.user.active_x_user_id}
      manageStaffXUserIds={getManageStaffXUserIdsFromSnapshot(authorization)}
    >
      {sp.saved === "1" ? (
        <p className="fn-alert fn-alert-success">
          設定を保存し、同期を予約しました。Queueが有効ならすぐ処理を開始します。
        </p>
      ) : null}
      {sp.queued === "1" ? (
        <p className="fn-alert fn-alert-success">
          同期を予約しました。Queueが有効ならすぐ処理を開始します。
        </p>
      ) : null}
      {sp.error ? <p className="fn-alert fn-alert-danger">{sp.error}</p> : null}

      <section className="manage-section">
        <h2 className="fn-console-eyebrow">同期設定</h2>
        <p className="fn-console-note manage-playlist-intro">
          OAuthで認証した1つのYouTubeチャンネルが所有する再生リストを対象にします。
          この画面で同期方式を有効にしたイベントだけが同期されます。
        </p>

        <div className="manage-playlist-steps" aria-label="設定の手順">
          <span><b>1</b> 再生リストを指定</span>
          <span><b>2</b> 同期方法を選択</span>
          <span><b>3</b> 保存して同期を開始</span>
        </div>
        <form action={saveEventYoutubePlaylistSettings} className="manage-playlist-form">
          <input type="hidden" name="event_id" value={ev.id} />
          <div>
            <label className="fn-label">再生リストURL / ID</label>
            <input
              name="playlist_id"
              className="fn-input"
              defaultValue={playlistId}
              placeholder="https://www.youtube.com/playlist?list=..."
              disabled={!canEdit}
              maxLength={300}
            />
          </div>
          <div className="manage-playlist-options">
            <div>
              <label className="fn-label">同期方式</label>
              <select
                name="sync_mode"
                className="fn-select"
                defaultValue={mode}
                disabled={!canEdit}
              >
                <option value="off">同期しない</option>
                <option value="append_only">追加のみ（推奨）</option>
                <option value="mirror">完全同期</option>
              </select>
            </div>
            <div>
              <label className="fn-label">同期間隔</label>
              <select
                name="sync_interval_minutes"
                className="fn-select"
                defaultValue={String(interval)}
                disabled={!canEdit}
              >
                <option value="60">1時間</option>
                <option value="180">3時間</option>
                <option value="360">6時間</option>
                <option value="720">12時間（推奨）</option>
                <option value="1440">24時間</option>
                <option value="10080">7日</option>
              </select>
            </div>
          </div>
          <div className="fn-card manage-playlist-info">
            <strong>同期方式と並び順</strong>
            <p className="fn-muted fn-text-sm manage-playlist-info-copy">
              追加のみは、イベントの公開作品だけを追加し、YouTube側で手動追加した動画を削除しません。
              完全同期はイベント外の項目と同じ作品の重複項目も整理します。投稿枠付き作品は提出済みの投稿枠順を最優先し、枠がない作品は公開予定時刻・作成日時順で後ろに並べます。
              連続枠は先頭の投稿枠を基準にし、既存項目の順序ずれもWorkerの上限内で少量ずつ自動補正します。位置指定にはYouTube側の再生リストを「手動」並び替えに設定してください。
            </p>
          </div>
          {canEdit ? (
            <button type="submit" className="fn-btn fn-btn-primary">
              保存して同期を予約
            </button>
          ) : (
            <p className="fn-muted fn-text-sm">
              公開設定の編集権限がないため、現在の設定は閲覧のみです。
            </p>
          )}
        </form>
      </section>

      <section className="manage-section">
        <div className="manage-youtube-status-head">
          <h2 className="fn-console-eyebrow">同期状態</h2>
          <span className={`fn-badge ${statusClass(config?.sync_status)}`}>
            {STATUS_LABELS[config?.sync_status ?? "disabled"] ?? config?.sync_status}
          </span>
        </div>
        <dl className="manage-youtube-status-grid">
          <dt className="fn-muted">最終同期</dt>
          <dd>{config?.last_synced_at ? formatUnix(config.last_synced_at) : "未実行"}</dd>
          <dt className="fn-muted">最終全件確認</dt>
          <dd>{config?.last_full_scan_at ? formatUnix(config.last_full_scan_at) : "未実行"}</dd>
          <dt className="fn-muted">次回予定</dt>
          <dd>{config?.next_sync_at ? formatUnix(config.next_sync_at) : "なし"}</dd>
          <dt className="fn-muted">状態詳細</dt>
          <dd title={config?.last_error ?? undefined}>{syncDetailLabel(config?.last_error)}</dd>
        </dl>
        {playlistId ? (
          <p>
            <Link
              href={`https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="fn-btn fn-btn-ghost fn-btn-sm"
            >
              YouTubeで再生リストを開く
            </Link>
          </p>
        ) : null}
        {canEdit && config?.enabled === 1 ? (
          <>
            <form action={queueEventYoutubePlaylistSync}>
              <input type="hidden" name="event_id" value={ev.id} />
              <button type="submit" className="fn-btn fn-btn-ghost fn-btn-sm">
                今すぐ同期を予約
              </button>
            </form>
            <p className="fn-muted fn-text-sm" style={{ marginTop: 8 }}>
              remote状態と投稿枠順を再確認します。Queueを利用できない場合も予約はD1に残り、毎時52分のRecovery Cronが処理します。
            </p>
          </>
        ) : null}
      </section>

      <section className="manage-section">
        <h2 className="fn-console-eyebrow">無料枠向けの制御</h2>
        <ul className="fn-muted fn-text-sm manage-playlist-guardrails">
          <li>既定は12時間間隔・追加のみです。</li>
          <li>再生リスト全件確認はページ分割し、差分だけを書き込みます。</li>
          <li>既存の並び替えも1回で全部処理せず、少量ずつ継続します。</li>
          <li>1回のWorker実行と1日あたりのYouTubeクォータに上限を設け、超過分は次回へ繰り越します。</li>
          <li>OAuthのクライアントID・シークレット・更新トークンはWorker secretだけに保存します。</li>
        </ul>
      </section>
    </ManageEventPageShell>
  );
}
