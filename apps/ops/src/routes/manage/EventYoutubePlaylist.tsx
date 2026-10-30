import * as React from "react";
import type { ManagePlaylistResponse } from "@flamenode/contracts";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { OpsFetch } from "../../api/read.js";
import {
  playlistPagePath, playlistResultHref, queueManagePlaylist,
  readManagePlaylist, saveManagePlaylist,
  type PlaylistMutationResult,
} from "../../api/managePlaylist.js";
import { NotFoundView } from "../NotFoundView.js";
import { AUTH_UNAVAILABLE } from "../guard.js";
import { useApiResult } from "../useApiResult.js";

const DEFAULT_FETCH: OpsFetch = (path, init) => fetch(path, init);
const STATUS_LABELS: Record<string, string> = {
  disabled: "無効", idle: "実行待ち", scanning: "再生リスト確認中",
  synced: "同期済み", deferred: "クォータ・分割処理待ち", failed: "同期失敗",
};
const DETAIL_LABELS: Record<string, string> = {
  playlist_mutation_batch_continuing: "追加・削除の処理上限に達したため、次回へ継続します。",
  playlist_scan_continuing: "再生リストの全件確認を分割して続行しています。",
  playlist_stale_cleanup_continuing: "全件確認後の古い項目情報を分割して整理しています。",
  playlist_order_repair_continuing: "投稿枠順とのずれを少量ずつ自動補正しています。",
  playlist_order_repair_request_budget: "外部API呼び出し上限に達する前に停止し、次回へ順序補正を継続します。",
  playlist_order_repair_quota_deferred: "YouTube APIクォータの余裕が不足したため、既存項目の順序補正を後回しにしました。",
  playlist_order_repair_scan_limit_exceeded: "再生リストが大きく、安全に確認できる範囲を超えたため既存項目の自動並び替えを停止しました。",
  playlist_order_repair_ambiguous_remote_items: "YouTube側の対象動画に欠落・重複があり、安全な自動並び替えを確定できませんでした。",
  playlist_order_fallback_manual_sort_required: "YouTube側の並び順を「手動」にしてください。",
  youtube_quota_budget_deferred: "YouTube APIの日次クォータ上限に近いため、次回へ繰り越しました。",
};

function safeLabel(map: Record<string, string>, key: string | null | undefined, fallback: string): string {
  if (!key) return fallback;
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : key;
}
function statusBadge(status: string | null | undefined): string {
  return status === "failed" ? "fn-badge-danger"
    : status === "deferred" || status === "scanning" ? "fn-badge-warning"
    : status === "synced" ? "fn-badge-accent" : "fn-badge-soft";
}
function healthBadge(level: string): string {
  return level === "critical" ? "fn-badge-danger"
    : level === "warn" || level === "running" ? "fn-badge-warning"
    : level === "ok" ? "fn-badge-accent" : "fn-badge-soft";
}
function healthLabel(level: string): string {
  return ({ critical: "要対応", warn: "注意", running: "実行中", ok: "正常" } as Record<string, string>)[level] ?? "未確認";
}
function formatTime(unix: number | null | undefined): string {
  if (unix == null || !Number.isFinite(unix)) return "未実行";
  const date = new Date(unix * 1000);
  if (!Number.isFinite(date.getTime())) return "未実行";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short",
  }).format(date);
}

/** U01 presentation stays unmounted until MIG-0719 shell and MIG-0655 write APIs land. */
export function EventYoutubePlaylistBody({ data, search, onSave, onQueue, busy = false }: {
  data: ManagePlaylistResponse;
  search: URLSearchParams;
  onSave: (form: FormData) => void;
  onQueue: () => void;
  busy?: boolean;
}): React.ReactElement {
  const config = data.config;
  const playlistId = config?.playlist_id ?? "";
  const canEdit = data.canEdit;
  const level = data.syncHealth.level;
  return (
    <div className="manage-youtube-playlist">
      <header className="fn-page-head">
        <a href={"/manage/events/" + encodeURIComponent(data.event.id)}>イベント概要へ</a>
        <h1 className="fn-page-title">YouTube再生リスト同期</h1>
        <p>{data.event.title}の公開作品を、指定した再生リストへ差分同期します。</p>
      </header>
      {search.get("saved") === "1" ? <p role="status" className="fn-alert fn-alert-success">設定を保存し、同期を予約しました。Queueが有効ならすぐ処理を開始します。</p> : null}
      {search.get("queued") === "1" ? <p role="status" className="fn-alert fn-alert-success">同期を予約しました。Queueが有効ならすぐ処理を開始します。</p> : null}
      {search.has("error") ? <p role="alert" className="fn-alert fn-alert-danger">{search.get("error")}</p> : null}

      <section className="manage-section">
        <h2 className="fn-console-eyebrow">同期設定</h2>
        <p className="fn-console-note">OAuthで認証した1つのYouTubeチャンネルが所有する再生リストを対象にします。この画面で同期方式を有効にしたイベントだけが同期されます。</p>
        <div className="manage-playlist-steps" aria-label="設定の手順">
          <span><b>1</b> 再生リストを指定</span>
          <span><b>2</b> 同期方法を選択</span>
          <span><b>3</b> 保存して同期を開始</span>
        </div>
        <form className="manage-playlist-form" onSubmit={(event) => {
          event.preventDefault();
          if (canEdit && !busy) onSave(new FormData(event.currentTarget));
        }}>
          <input type="hidden" name="event_id" value={data.event.id} />
          <label className="fn-label">再生リストURL / ID
            <input name="playlist_id" className="fn-input" defaultValue={playlistId}
              placeholder="https://www.youtube.com/playlist?list=..." maxLength={300} disabled={!canEdit || busy} />
          </label>
          <div className="manage-playlist-options">
            <label className="fn-label">同期方式
              <select name="sync_mode" className="fn-select" defaultValue={config?.sync_mode ?? "off"} disabled={!canEdit || busy}>
                <option value="off">同期しない</option>
                <option value="append_only">追加のみ（推奨）</option>
                <option value="mirror">完全同期</option>
              </select>
            </label>
            <label className="fn-label">同期間隔
              <select name="sync_interval_minutes" className="fn-select"
                defaultValue={String(config?.sync_interval_minutes ?? 720)} disabled={!canEdit || busy}>
                <option value="60">1時間</option><option value="180">3時間</option>
                <option value="360">6時間</option><option value="720">12時間（推奨）</option>
                <option value="1440">24時間</option><option value="10080">7日</option>
              </select>
            </label>
          </div>
          <div className="fn-card manage-playlist-info">
            <strong>同期方式と並び順</strong>
            <p>追加のみはイベントの公開作品だけを追加し、YouTube側の手動追加を削除しません。完全同期はイベント外や重複する項目も整理します。投稿枠付き作品は投稿枠順を優先し、既存項目の順序補正はWorkerの上限内で少量ずつ続行します。YouTube側では「手動」並び順を指定してください。</p>
          </div>
          {canEdit ? <button type="submit" className="fn-btn fn-btn-primary" disabled={busy}>保存して同期を予約</button>
            : <p className="fn-muted fn-text-sm">公開設定の編集権限がないため、現在の設定は閲覧のみです。</p>}
        </form>
      </section>

      <section className="manage-section">
        <h2 className="fn-console-eyebrow">同期状態</h2>
        <div className="manage-youtube-status-head">
          <span className={"fn-badge " + healthBadge(level)} title={"health: " + data.syncHealth.reason}>{healthLabel(level)}</span>
          <span className={"fn-badge " + statusBadge(config?.sync_status)}>{safeLabel(STATUS_LABELS, config?.sync_status, "無効")}</span>
        </div>
        <dl className="manage-youtube-status-grid">
          <dt>作品同期</dt><dd>同期済み {data.counts.synced} / 対象 {data.counts.eligible}（紐付き {data.counts.linked}）</dd>
          <dt>最終同期</dt><dd>{formatTime(config?.last_synced_at)}</dd>
          <dt>最終全件確認</dt><dd>{formatTime(config?.last_full_scan_at)}</dd>
          <dt>次回予定</dt><dd>{config?.next_sync_at == null ? "なし" : formatTime(config.next_sync_at)}</dd>
          <dt>状態詳細</dt><dd>{safeLabel(DETAIL_LABELS, config?.last_error, "なし")}</dd>
        </dl>
        {playlistId ? <a href={"https://www.youtube.com/playlist?list=" + encodeURIComponent(playlistId)}
          target="_blank" rel="noopener noreferrer" className="fn-btn fn-btn-ghost fn-btn-sm">YouTubeで再生リストを開く</a> : null}
        {canEdit && config?.enabled === 1 ? (
          <>
            <form onSubmit={(event) => { event.preventDefault(); if (!busy) onQueue(); }}>
              <input type="hidden" name="event_id" value={data.event.id} />
              <button type="submit" className="fn-btn fn-btn-ghost fn-btn-sm" disabled={busy}>今すぐ同期を予約</button>
            </form>
            <p className="fn-muted fn-text-sm">remote状態と投稿枠順を再確認します。Queueを利用できない場合も予約はD1に残り、毎時52分のRecovery Cronが処理します。</p>
          </>
        ) : null}
      </section>

      <section className="manage-section">
        <h2 className="fn-console-eyebrow">無料枠向けの制御</h2>
        <ul className="fn-muted fn-text-sm">
          <li>既定は12時間間隔・追加のみです。</li>
          <li>再生リスト全件確認はページ分割し、差分だけを書き込みます。</li>
          <li>既存の並び替えも1回で全部処理せず、少量ずつ継続します。</li>
          <li>YouTube APIの実行・クォータ上限を超えた処理は次回へ繰り越します。</li>
          <li>OAuthのシークレットはWorker secretだけに保存します。</li>
        </ul>
      </section>
    </div>
  );
}

/** Explicit access denial is authoritative, even if a same-key refresh previously succeeded. */
function playlistAuthRedirect(eventId: string, result: {status: string; reason?: string}): string | null {
  if (result.status === "anonymous") return "/entry?next=" + encodeURIComponent(playlistPagePath(eventId));
  if (result.status === "forbidden") return AUTH_UNAVAILABLE;
  return null;
}

function PlaylistForEvent({ eventId, fetchFn }: { eventId: string; fetchFn: OpsFetch }): React.ReactElement {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const inFlight = React.useRef(false);
  const currentId = React.useRef(eventId);
  currentId.current = eventId;
  const result = useApiResult((signal) => readManagePlaylist(fetchFn, eventId, signal), eventId, refreshKey);
  const authRedirect = playlistAuthRedirect(eventId, result);
  React.useEffect(() => {
    if (authRedirect) window.location.assign(authRedirect);
  }, [authRedirect]);

  async function mutate(action: "saved" | "queued", form?: FormData): Promise<void> {
    if (inFlight.current || result.status !== "ok" || !result.data.canEdit) return;
    if (action === "queued" && result.data.config?.enabled !== 1) return;
    inFlight.current = true;
    setBusy(true);
    let outcome: PlaylistMutationResult;
    try {
      outcome = action === "saved"
        ? await saveManagePlaylist(fetchFn, eventId, form ?? new FormData())
        : await queueManagePlaylist(fetchFn, eventId);
    } catch {
      outcome = { status: "unavailable" };
    }
    if (currentId.current !== eventId) return;
    inFlight.current = false;
    setBusy(false);
    if (outcome.status === "anonymous" || outcome.status === "forbidden") {
      window.location.assign(outcome.status === "anonymous"
        ? "/entry?next=" + encodeURIComponent(playlistPagePath(eventId)) : AUTH_UNAVAILABLE);
      return;
    }
    if (outcome.status === "notFound") {
      navigate("/manage", { replace: true });
      return;
    }
    navigate(playlistResultHref(eventId, action, outcome));
    setRefreshKey((previous) => previous + 1);
  }
  if (result.status === "loading" || authRedirect) return <div role="status" aria-busy="true">読み込み中...</div>;
  if (result.status === "notFound") return <NotFoundView />;
  if (result.status !== "ok") return <div role="alert">同期設定を取得できませんでした。再読み込みしてください。</div>;
  return <EventYoutubePlaylistBody key={result.data.event.id} data={result.data} search={search}
    busy={busy} onSave={(form) => { void mutate("saved", form); }} onQueue={() => { void mutate("queued"); }} />;
}

export function EventYoutubePlaylist({ fetchFn = DEFAULT_FETCH }: { fetchFn?: OpsFetch }): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  if (!id) return <NotFoundView />;
  return <PlaylistForEvent key={id} eventId={id} fetchFn={fetchFn} />;
}
