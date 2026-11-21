/** MIG-0736 U02b: Worker monitoring display port, unmounted until Admin shell owner releases router. */
import * as React from "react";
import type { AdminWorkersResponse } from "@flamenode/contracts";
import type { OpsFetch } from "../../api/read.js";
import type { OpsDataState } from "../useApiResult.js";
import { useApiResult } from "../useApiResult.js";
import { getAdminWorkers } from "../../api/adminDiagnostics.js";
import { AdminSectionTabs } from "../../components/shared/AdminSectionTabs.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { FnTable } from "../../components/shared/FnTable.js";
import { OpsLink as Link } from "../../components/shared/OpsLink.js";

type Snapshot = NonNullable<AdminWorkersResponse["snapshot"]>;
type MonitorLevel = Snapshot["jobs"][number]["level"];
type WorkerJobStatus = Snapshot["jobs"][number];
type QueueSnapshot = Snapshot["notifications"];
type PipelineSnapshot = Snapshot["pipelines"][number];
type QueueWakeFailures = Snapshot["queueWakeFailures"];

const fullDate = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit",
});
function formatUnix(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? "-" : fullDate.format(date);
}
function formatRelative(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  const diff = Date.now() / 1000 - value;
  if (diff < 60) return "今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}日前`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}か月前`;
  return `${Math.floor(diff / 31536000)}年前`;
}
function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 10000) return `${(value / 1000).toFixed(1)}k`;
  if (value < 1000000) return `${Math.floor(value / 1000)}k`;
  if (value < 10000000) return `${(value / 1000000).toFixed(1)}M`;
  return `${Math.floor(value / 1000000)}M`;
}
// Same CURRENT static limits. Cloudflare Dashboard remains the authoritative usage source.
const PLATFORM_LIMITS = [
  { label: "Workers CPU", value: "10ms / invocation" },
  { label: "Worker subrequests", value: "50 / invocation" },
  { label: "D1 queries", value: "50 / invocation" },
  { label: "D1 rows read", value: "5,000,000 / day" },
  { label: "D1 rows written", value: "100,000 / day" },
  { label: "D1 database size", value: "500MB / database" },
  { label: "YouTube Data API", value: "10,000 units / day" },
] as const;

function badgeClass(level: MonitorLevel): string {
  if (level === "critical") return "fn-badge-danger";
  if (level === "warn" || level === "running") return "fn-badge-warning";
  if (level === "ok") return "fn-badge-accent";
  return "fn-badge-soft";
}
function levelLabel(level: MonitorLevel): string {
  if (level === "critical") return "要対応";
  if (level === "warn") return "注意";
  if (level === "running") return "実行中";
  if (level === "ok") return "正常";
  return "未確認";
}
function durationLabel(minutes: number): string {
  if (minutes <= 0) return "待ちなし";
  if (minutes < 60) return `約${minutes}分`;
  if (minutes < 24 * 60) return `約${Math.ceil(minutes / 60)}時間`;
  return `約${Math.ceil(minutes / (24 * 60))}日`;
}
function statusStyle(level: Exclude<MonitorLevel, "running">): React.CSSProperties {
  if (level === "critical") return { background: "var(--accent-danger-soft, #fee2e2)", borderColor: "var(--accent-danger, #dc2626)", color: "var(--accent-danger, #991b1b)" };
  if (level === "warn" || level === "unknown") return { background: "var(--accent-warning-soft, #fef3c7)", borderColor: "var(--accent-warning, #d97706)", color: "var(--accent-warning, #92400e)" };
  return { background: "var(--accent-success-soft, #dcfce7)", borderColor: "var(--accent-success, #16a34a)", color: "var(--accent-success, #166534)" };
}

export function AdminWorkersView({ data, onRefresh }: {
  data: OpsDataState<AdminWorkersResponse>;
  onRefresh: () => void;
}): React.ReactElement {
  const snapshot = data.status === "ok" && data.data.error === null ? data.data.snapshot : null;
  return (
    <div>
      <ConsolePageHeader title="バックグラウンド処理監視"
        description="Cron Worker、通知、静的JSON、YouTube同期、スコア更新の遅延と失敗をD1の内部記録から確認します。" />
      <AdminSectionTabs hub="health" />
      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="fn-btn fn-btn-primary fn-btn-sm" onClick={onRefresh}>最新状態へ更新</button>
        <Link href="/admin/cost-guard" className="fn-btn fn-btn-ghost fn-btn-sm">operation_mode管理</Link>
        <Link href="/admin/health" className="fn-btn fn-btn-ghost fn-btn-sm">DBヘルスチェック</Link>
      </div>
      {data.status === "loading" ? <p role="status">読み込み中…</p>
        : data.status === "ok" && data.data.error === null && snapshot === null
          ? <p role="status">監視スナップショットがありません。</p>
        : data.status !== "ok" || data.data.error !== null
          ? <p role="alert" style={{ marginTop: 18 }}>
              {data.status === "anonymous" ? "ログインが必要です。"
                : data.status === "forbidden" || data.status === "notFound" ? "閲覧権限がありません。"
                : data.status === "unsupported" ? "監視機能は現在利用できません。"
                : "監視情報の取得に失敗しました。"}
            </p>
          : null}
      {snapshot ? <MonitoringContent snapshot={snapshot} /> : null}
    </div>
  );
}

export function AdminWorkers({ fetchFn = fetch }: { fetchFn?: OpsFetch }): React.ReactElement {
  const [refreshKey, setRefreshKey] = React.useState(0);
  const data = useApiResult((signal) => getAdminWorkers(fetchFn, signal), "admin-workers", refreshKey);
  return <AdminWorkersView data={data} onRefresh={() => setRefreshKey((key) => key + 1)} />;
}

function queueWakeKindLabel(kind: string): string {
  if (kind === "notification_available") return "通知";
  if (kind === "static_rebuild_available") return "静的JSON";
  if (kind === "youtube_sync_pending") return "YouTube同期";
  return kind;
}

function activeQueueWakeFailures(
  failures: QueueWakeFailures | null,
): { kind: string; at: number; reason: string }[] {
  if (!failures) return [];
  return Object.entries(failures)
    .filter((entry): entry is [string, { at: number; reason: string }] => entry[1] != null)
    .map(([kind, record]) => ({ kind, ...record }));
}

function MonitoringContent({ snapshot }: { snapshot: Snapshot }): React.ReactElement {
  const criticalJobs = snapshot.jobs.filter((job) => job.level === "critical").length;
  const problemPipelines = snapshot.pipelines.filter((pipeline) => pipeline.level !== "ok").length;
  const totalFailures =
    snapshot.notifications.failed
    + snapshot.notifications.deadLetter
    + snapshot.staticRebuilds.failed
    + snapshot.staticRebuilds.deadLetter
    + snapshot.youtube.failed;
  const queueWakeFailures = activeQueueWakeFailures(snapshot.queueWakeFailures);

  return (
    <>
      <section role="status" className="fn-card" style={{ marginTop: 18, padding: "14px 16px", borderWidth: 1, borderStyle: "solid", ...statusStyle(snapshot.overallLevel) }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <strong>{levelLabel(snapshot.overallLevel)}</strong>
            <p style={{ margin: "4px 0 0", fontSize: 13 }}>{snapshot.overallMessage}</p>
          </div>
          <div style={{ fontSize: 12 }}>取得: {formatUnix(snapshot.generatedAt)}</div>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 16 }}>
        <StatCard label="operation_mode" value={snapshot.operationMode} />
        <StatCard label="停止・失敗Worker" value={formatCount(criticalJobs)} />
        <StatCard label="注意パイプライン" value={formatCount(problemPipelines)} />
        <StatCard label="失敗データ" value={formatCount(totalFailures)} />
      </section>

      {queueWakeFailures.length > 0 ? (
        <div
          role="alert"
          style={{
            marginTop: 16,
            padding: "12px 16px",
            border: "1px solid var(--accent-danger, #dc2626)",
            borderRadius: "var(--radius-md)",
            color: "var(--accent-danger, #991b1b)",
          }}
        >
          <strong>Queue wake 最終失敗</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>
            {queueWakeFailures.map((failure) => (
              <li key={failure.kind}>
                {queueWakeKindLabel(failure.kind)}: {failure.reason}（{formatUnix(failure.at)}）
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Cron実行状態</h2>
        <div style={{ overflowX: "auto" }}>
          <FnTable style={{ minWidth: 940 }}>
            <thead><tr><th>ジョブ</th><th>状態</th><th>最終開始</th><th>最終成功</th><th>最終失敗</th><th>次回目安</th><th>エラー</th><th></th></tr></thead>
            <tbody>{snapshot.jobs.map((job) => <WorkerRow key={job.jobName} job={job} />)}</tbody>
          </FnTable>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>キュー状態</h2>
        <div style={{ overflowX: "auto" }}>
          <FnTable style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>処理</th>
                <th>pending</th>
                <th>最古pending</th>
                <th>failed</th>
                <th>dead_letter</th>
                <th>stuck</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <QueueMetricsRow
                label="通知配信"
                queue={snapshot.notifications}
                detailHref="/admin/notifications"
              />
              <QueueMetricsRow
                label="静的JSON再生成"
                queue={snapshot.staticRebuilds}
                detailHref="/admin/static-builds"
              />
              <tr>
                <td style={{ fontWeight: 700 }}>YouTubeメタデータ同期</td>
                <td>{formatCount(snapshot.youtube.pending)}</td>
                <TimeCell value={snapshot.youtube.oldestPendingAt} />
                <td>{formatCount(snapshot.youtube.failed)}</td>
                <td>—</td>
                <td>—</td>
                <td>
                  <Link href="/admin/youtube-sync" className="fn-btn fn-btn-ghost fn-btn-sm">
                    管理
                  </Link>
                </td>
              </tr>
            </tbody>
          </FnTable>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>処理能力と滞留</h2>
        <p className="fn-muted fn-text-sm" style={{ margin: "0 0 10px" }}>新規流入が止まった場合の理論解消時間です。外部API障害やCloudflare側の制限は含みません。</p>
        <div style={{ overflowX: "auto" }}>
          <FnTable style={{ minWidth: 820 }}>
            <thead><tr><th>処理</th><th>状態</th><th>滞留</th><th>最大処理/日</th><th>解消目安</th><th>補足</th><th></th></tr></thead>
            <tbody>{snapshot.pipelines.map((pipeline) => <PipelineRow key={pipeline.id} pipeline={pipeline} />)}</tbody>
          </FnTable>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>グローバル静的JSONの最終生成</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          {snapshot.artifacts.length === 0 ? <div className="fn-card" style={{ padding: 14 }}>生成履歴がありません。</div> : snapshot.artifacts.map((artifact) => (
            <div key={artifact.targetType} className="fn-card" style={{ padding: 14 }}>
              <code>{artifact.targetType}</code>
              <div style={{ marginTop: 6, fontSize: 13 }}>{artifact.generatedAt == null ? "未生成" : formatRelative(artifact.generatedAt)}</div>
              <div className="fn-muted fn-text-sm">{formatUnix(artifact.generatedAt)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="fn-card" style={{ marginTop: 24, padding: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>無料枠の外部監視</h2>
        <p className="fn-muted fn-text-sm" style={{ margin: "0 0 12px" }}>CPU時間、exceededCpu、アカウント全体のD1日次使用量はアプリDBだけでは取得できません。Cloudflare Dashboardを正本として確認してください。</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
          {PLATFORM_LIMITS.map((limit) => (
            <div key={limit.label} style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
              <div className="fn-muted fn-text-sm">{limit.label}</div><strong>{limit.value}</strong>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer" className="fn-btn fn-btn-ghost fn-btn-sm">Cloudflare Dashboard</a>
          <a href="https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas" target="_blank" rel="noopener noreferrer" className="fn-btn fn-btn-ghost fn-btn-sm">YouTube API Quotas</a>
        </div>
      </section>
    </>
  );
}

function WorkerRow({ job }: { job: WorkerJobStatus }): React.ReactElement {
  return (
    <tr>
      <td><div style={{ fontWeight: 700 }}>{job.label}</div><code className="fn-muted fn-text-sm">{job.jobName}</code><div className="fn-muted fn-text-sm">{job.message}</div></td>
      <td><span className={`fn-badge ${badgeClass(job.level)}`}>{levelLabel(job.level)}</span></td>
      <TimeCell value={job.lastStartedAt} /><TimeCell value={job.lastSucceededAt} /><TimeCell value={job.lastFailedAt} /><TimeCell value={job.nextExpectedAt} />
      <td style={{ maxWidth: 240, wordBreak: "break-word", fontSize: 12 }}>{job.lastErrorCode ?? "—"}</td>
      <td><Link href={job.detailHref} className="fn-btn fn-btn-ghost fn-btn-sm">詳細</Link></td>
    </tr>
  );
}

function QueueMetricsRow({
  label,
  queue,
  detailHref,
}: {
  label: string;
  queue: QueueSnapshot;
  detailHref: string;
}): React.ReactElement {
  return (
    <tr>
      <td style={{ fontWeight: 700 }}>{label}</td>
      <td>{formatCount(queue.pending)}</td>
      <td title={formatUnix(queue.oldestPendingAt)}>{queue.oldestPendingAt == null ? "—" : formatRelative(queue.oldestPendingAt)}</td>
      <td>{formatCount(queue.failed)}</td>
      <td>{formatCount(queue.deadLetter)}</td>
      <td>{formatCount(queue.stuck)}</td>
      <td><Link href={detailHref} className="fn-btn fn-btn-ghost fn-btn-sm">管理</Link></td>
    </tr>
  );
}

function PipelineRow({ pipeline }: { pipeline: PipelineSnapshot }): React.ReactElement {
  return (
    <tr>
      <td style={{ fontWeight: 700 }}>{pipeline.label}</td><td><span className={`fn-badge ${badgeClass(pipeline.level)}`}>{levelLabel(pipeline.level)}</span></td>
      <td>{formatCount(pipeline.backlog)}</td><td>{formatCount(pipeline.capacityPerDay)}</td><td>{durationLabel(pipeline.estimatedDrainMinutes)}</td>
      <td className="fn-muted fn-text-sm">{pipeline.note}</td><td><Link href={pipeline.detailHref} className="fn-btn fn-btn-ghost fn-btn-sm">管理</Link></td>
    </tr>
  );
}

function TimeCell({ value }: { value: number | null }): React.ReactElement {
  return <td title={formatUnix(value)} style={{ fontSize: 12 }}>{value == null ? "—" : formatRelative(value)}</td>;
}

function StatCard({ label, value }: { label: string; value: string }): React.ReactElement {
  return <div className="fn-card" style={{ padding: "12px 14px" }}><div className="fn-muted fn-text-sm">{label}</div><div style={{ fontSize: 22, fontWeight: 800, wordBreak: "break-word" }}>{value}</div></div>;
}
