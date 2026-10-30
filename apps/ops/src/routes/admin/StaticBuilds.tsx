import * as React from "react";
import type { AdminStaticBuildsResponse } from "@flamenode/contracts";
import { postAdminOp, readStaticBuilds, mutationResultQuery, canContinueBackfill } from "../../api/adminStaticBuilds.js";
import { StaticRebuildQueuePanel } from "./StaticRebuildQueuePanel.js";

const KINDS = ["video_v2", "user_profile", "event_crew"] as const;
const TARGETS = ["top", "top_recommended", "top_latest", "top_nostalgic", "top_events", "top_announcements", "top_stats",
  "top_slot_stats", "events_index", "event_base", "event_slots", "event_release", "event", "video", "user",
  "users_index", "list_recent", "list_popular", "search_index", "recommend_core", "recommend", "rules",
  "youtube_related_blocklist", "random_video_pool", "member_suggestions"] as const;

export function StaticBuilds(): React.ReactElement {
  const [data, setData] = React.useState<AdminStaticBuildsResponse | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [refreshId, setRefreshId] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    void readStaticBuilds(undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.status === "ok") { setData(result.data); setLoadError(null); }
      else { setData(null); setLoadError(result.status === "anonymous" ? "再ログインが必要です。" : "取得できませんでした。"); }
    });
    return () => controller.abort();
  }, [refreshId]);
  async function mutate(path: string, payload: Record<string, string>, carryQuery = false): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setLoadError(null);
    try {
      const result = await postAdminOp(path, payload);
      if (result.status !== "ok" && result.status !== "outcome") {
        setLoadError(result.status === "anonymous" ? "再ログインが必要です。" : "操作できませんでした。更新後に状態を確認してください。");
        return;
      }
      if (carryQuery) {
        const query = mutationResultQuery(result.data);
        window.history.replaceState(null, "", window.location.pathname + (query ? "?" + query : ""));
      }
      setRefreshId(id => id + 1);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const query = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const backfillKind = query.get("backfill_kind");
  const visibility = query.get("visibility_repair");
  const visibilityMessages: Record<string, string> = {
    repaired: "R2 manifest のdangling fence候補を解除しました。",
    d1_fence_present: "D1 に現行 fence があるため解除しませんでした。",
    manifest_token_not_found: "R2 manifest に一致する token がないため変更しませんでした。",
    invalid_input: "修復対象の入力が不正です。",
    forbidden: "この修復操作を実行する権限がありません。",
    failed: "修復操作に失敗しました。ログとdeep healthを確認してください。",
  };
  const stateFailed = query.get("backfill_state_persisted") === "0";
  return <div className="fn-public-container fn-page">
    <header className="fn-page-head"><h1>静的JSON再生成</h1>
      <p>編集駆動のR2公開用JSONキュー。Next.jsのビルドとは別です。</p></header>
    {loadError && <p role="alert">{loadError}</p>}
    {!data ? <p role="status">読み込み中または取得失敗</p> : <>
      <section className="fn-card" style={{ padding: 16 }}>
        <h2>運用モード</h2><p>{data.operationMode} / 1回の最大処理数 {data.maxItemsPerRun}</p>
      </section>
      <section className="fn-card" style={{ padding: 16 }}>
        <h2>共有JSON診断</h2>
        <p>現在のAPIはR2オブジェクト存在情報のみです。ロード状態・生成日時・件数は未評価（MIG-0627）。</p>
        <button type="button" disabled={busy} className="fn-btn fn-btn-primary"
          onClick={() => void mutate("static-builds/shared-inputs/rebuild", {})}>関連動画の共有JSONを再生成キュー投入</button>
        <dl>{data.sharedInputs.map(item => <React.Fragment key={item.kind}>
          <dt>{item.kind}（{item.objectKey}）</dt>
          <dd>R2: {item.objectState} / load: — / generated_at: — / 件数: —</dd>
        </React.Fragment>)}</dl>
      </section>
      <section className="fn-card" style={{ padding: 16 }}>
        <h2>処理状態</h2><dl>{Object.entries(data.counts).map(([key, val]) =>
          <React.Fragment key={key}><dt>{key}</dt><dd>{val}</dd></React.Fragment>)}</dl>
      </section>
      <section className="fn-card" style={{ padding: 16 }}>
        <h2>手動キュー投入</h2>
        <form className="fn-form-grid" onSubmit={event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void mutate("static-builds/rebuild", {
            target_type: String(form.get("target_type") ?? ""),
            target_id: String(form.get("target_id") ?? ""),
            reason: String(form.get("reason") ?? ""),
          });
        }}>
          <label>対象種別 <select name="target_type" className="fn-select">{TARGETS.map(kind =>
            <option key={kind} value={kind}>{kind}</option>)}</select></label>
          <label>対象ID <input name="target_id" required maxLength={128} className="fn-input" /></label>
          <label>理由 <input name="reason" defaultValue="manual_rebuild" maxLength={500} className="fn-input" /></label>
          <button type="submit" disabled={busy} className="fn-btn fn-btn-primary">高優先度で投入</button>
        </form>
      </section>
      <section className="fn-card" style={{ padding: 16 }}>
        <h2>Visibility fence の手動修復</h2>
        <p>必ずD1に同じfenceが無いことを確認してから使用してください。tokenが変わった場合は解除しません。</p>
        {visibility && <p role="status">{visibilityMessages[visibility] ?? visibilityMessages.failed}</p>}
        <form className="fn-form-grid" onSubmit={event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void mutate("visibility-repair", {
            entity_type: String(form.get("entity_type") ?? ""),
            entity_id: String(form.get("entity_id") ?? ""),
            fence_token: String(form.get("fence_token") ?? ""),
          }, true);
        }}>
          <label>entity type <select name="entity_type" className="fn-select">
            {["event", "video", "x_user", "event_group"].map(v => <option key={v}>{v}</option>)}
          </select></label>
          <label>entity ID <input name="entity_id" required maxLength={128} /></label>
          <label>fence token <input name="fence_token" required maxLength={160} /></label>
          <button type="submit" className="fn-btn" disabled={busy}>D1不在を再確認して修復</button>
        </form>
      </section>
      <section className="fn-card" style={{ padding: 16 }}>
        <h2>段階的バックフィル（12件ずつ）</h2>
        {backfillKind && <p role="status">直近: {backfillKind}{query.get("backfill_error") ? " / error=" + query.get("backfill_error") : " / scanned=" + (query.get("backfill_scanned") ?? "—") + " / enqueued=" + (query.get("backfill_enqueued") ?? "—")}{query.get("backfill_done") === "1" ? " / 完了" : query.get("backfill_cursor") ? " / next=" + query.get("backfill_cursor") : ""}</p>}
        {query.get("backfill_error") && <p role="alert">バックフィルが失敗しました。エラー内容を確認してください。</p>}
        {stateFailed && <p role="alert">KVに進捗を保存できませんでした。キュー投入自体は完了している可能性があります。</p>}
        {KINDS.map(kind => {
          const run = data.backfillState.runs[kind];
          const queue = data.backfillQueue[kind];
          const completed = !canContinueBackfill(run.status);
          return <article key={kind} style={{ padding: 12, border: "1px solid var(--border-subtle)" }}>
            <h3>{kind}</h3>
            <p>{run.status} / 対象 {run.total} / 走査 {run.scanned} / 投入 {run.enqueued} / 残り {Math.max(0, run.total - run.scanned)}</p>
            <p>pending {queue.pending} / processing {queue.processing} / failed {queue.failed}</p>
            {(queue.lastError ?? run.last_error) && <p role="alert">{queue.lastError ?? run.last_error}</p>}
            <button type="button" className="fn-btn fn-btn-primary" disabled={busy || completed}
              onClick={() => void mutate("static-builds/backfill", { kind, mode: "continue", cursor: run.cursor ?? "" }, true)}>
              {completed ? "完了" : run.cursor ? "続きを投入" : "先頭から投入"}</button>
            <button type="button" className="fn-btn" disabled={busy}
              onClick={() => void mutate("static-builds/backfill", { kind, mode: "restart", cursor: "" }, true)}>先頭から再実行</button>
          </article>;
        })}
      </section>
      <StaticRebuildQueuePanel rows={data.rows} busy={busy}
        retry={id => void mutate("static-builds/queue/" + encodeURIComponent(id) + "/retry", {})}
        retryAll={() => void mutate("static-builds/retry-failed", {})} />
      {data.truncated && <p role="status">一覧は応答サイズの上限により一部省略されています。</p>}
    </>}
  </div>;
}
