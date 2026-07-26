import * as React from "react";
import type { Metadata } from "next";
import { desc, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { staticRebuildQueue, systemSettings } from "@/lib/db/schema";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { enqueueStaticRebuildAdmin, enqueueStaticBackfillBatch, retryAllFailedStaticRebuild } from "@/lib/actions/static-rebuild-admin";
import { StaticRebuildQueuePanel } from "@/components/admin/StaticRebuildQueuePanel";
import { staticRebuildStatusLabel, staticRebuildTargetIdHint, staticRebuildTargetLabel } from "@/lib/admin/staticRebuildLabels";
import { resolveOperationMode } from "@/lib/operationMode/resolve";
import { getStaticRebuildPolicy } from "@/lib/operationMode/policy";
import { OPERATION_MODE_DESCRIPTIONS, OPERATION_MODE_LABELS } from "@/lib/operationMode/types";
import { STATIC_REBUILD_TARGET_TYPES } from "@/lib/staticRebuild/types";
import Link from "next/link";

export const metadata: Metadata = { title: "静的JSON再生成" };
export const dynamic = "force-dynamic";

const TARGET_TYPES = STATIC_REBUILD_TARGET_TYPES;
const BACKFILL_KINDS = [
  { kind: "event_crew", label: "event_crew（公開イベント）" },
  { kind: "video_v2", label: "video_v2（公開動画）" },
  { kind: "user_profile", label: "user_profile（公開可能 X ID）" },
] as const;

export default async function AdminStaticBuildsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const params = (await searchParams) ?? {};
  const backfillKind = String(params.backfill_kind ?? "");
  const backfillCursor = String(params.backfill_cursor ?? "");
  const backfillScanned = String(params.backfill_scanned ?? "");
  const backfillEnqueued = String(params.backfill_enqueued ?? "");
  const backfillDone = String(params.backfill_done ?? "") === "1";

  const db = getDatabase();
  let rows: (typeof staticRebuildQueue.$inferSelect)[] = [];
  let counts = { pending: 0, processing: 0, failed: 0, dead_letter: 0, done: 0 };
  let operationMode = resolveOperationMode(null);

  if (db) {
    rows = await db
      .select()
      .from(staticRebuildQueue)
      .orderBy(desc(staticRebuildQueue.updated_at))
      .limit(80);

    const countRows = await db
      .select({
        status: staticRebuildQueue.status,
        c: sql<number>`COUNT(*)`,
      })
      .from(staticRebuildQueue)
      .groupBy(staticRebuildQueue.status);

    for (const r of countRows) {
      const n = Number(r.c ?? 0);
      if (r.status === "pending") counts.pending = n;
      if (r.status === "processing") counts.processing = n;
      if (r.status === "failed") counts.failed = n;
      if (r.status === "dead_letter") counts.dead_letter = n;
      if (r.status === "done") counts.done = n;
    }

    const settings = (
      await db
        .select({
          operation_mode: systemSettings.operation_mode,
        })
        .from(systemSettings)
        .limit(1)
    )[0];
    operationMode = resolveOperationMode(settings ?? null);
  }

  const rebuildPolicy = getStaticRebuildPolicy(operationMode);

  return (
    <div>
      <AdminPageHeader
        title="静的JSON再生成"
        description="R2 公開用 JSON の編集駆動キュー。Next.js 本体のビルドとは別です。"
      />

      <section
        className="fn-card"
        style={{ marginBottom: 20, padding: "14px 16px" }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
          operation_mode（サイト全体）
        </h2>
        <p style={{ margin: "0 0 6px", fontSize: 13 }}>
          <span className="fn-badge fn-badge-soft">{OPERATION_MODE_LABELS[operationMode]}</span>{" "}
          <code>{operationMode}</code>
        </p>
        <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
          {OPERATION_MODE_DESCRIPTIONS[operationMode]}
          {" "}
          content-jobs は Queue wake で即時起動し、毎時 Recovery Cron で最大 {rebuildPolicy.maxItemsPerRun} target を処理します。
          economy では search_index / list_popular は high 優先度のみ処理されます。
        </p>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <StatCard label={staticRebuildStatusLabel("pending")} value={counts.pending} />
        <StatCard label={staticRebuildStatusLabel("processing")} value={counts.processing} />
        <StatCard label={staticRebuildStatusLabel("failed")} value={counts.failed} />
        <StatCard label={staticRebuildStatusLabel("dead_letter")} value={counts.dead_letter} />
        <StatCard label={staticRebuildStatusLabel("done")} value={counts.done} />
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
          手動でキュー投入
        </h2>
        <form action={enqueueStaticRebuildAdmin} className="fn-form-grid">
          <label className="fn-label">
            対象種別
            <select name="target_type" className="fn-select" defaultValue="event">
              {TARGET_TYPES.map((type) => (
                <option key={type} value={type}>
                  {staticRebuildTargetLabel(type)} ({type})
                </option>
              ))}
            </select>
          </label>
          <label className="fn-label">
            対象 ID
            <input
              name="target_id"
              className="fn-input"
              placeholder="event id / video id / global"
              data-hint="target_id"
            />
          </label>
          <label className="fn-label">
            理由
            <input name="reason" className="fn-input" defaultValue="manual_rebuild" />
          </label>
          <button type="submit" className="fn-btn fn-btn-primary">
            高優先度でキュー投入
          </button>
        </form>
        <p className="fn-muted fn-text-sm" style={{ marginTop: 8 }}>
          target_id の例: {staticRebuildTargetIdHint("event")} / {staticRebuildTargetIdHint("top")}
          。content-jobs が Queue wake で pending を処理し、毎時 Recovery Cron がバックアップします。
        </p>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
          段階的バックフィル（12件ずつ）
        </h2>
        {backfillKind ? (
          <p className="fn-muted fn-text-sm" style={{ marginBottom: 10 }}>
            直近: {backfillKind} / scanned={backfillScanned} / enqueued={backfillEnqueued}
            {backfillDone ? " / 完了" : backfillCursor ? ` / next=${backfillCursor}` : ""}
          </p>
        ) : null}
        <div style={{ display: "grid", gap: 12 }}>
          {BACKFILL_KINDS.map((entry) => {
            const active = backfillKind === entry.kind;
            const cursorValue = active ? backfillCursor : "";
            const done = active && backfillDone;
            return (
              <form
                key={entry.kind}
                action={enqueueStaticBackfillBatch}
                className="fn-form-grid"
                style={{
                  padding: 12,
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                <input type="hidden" name="kind" value={entry.kind} />
                <label className="fn-label">
                  {entry.label}
                  <input
                    name="cursor"
                    className="fn-input"
                    defaultValue={cursorValue}
                    placeholder="空欄で先頭から"
                  />
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    type="submit"
                    className="fn-btn fn-btn-primary"
                    disabled={done}
                  >
                    {done ? "完了" : cursorValue ? "続きを投入" : "先頭から投入"}
                  </button>
                  {done ? (
                    <Link href="/admin/static-builds" className="fn-btn fn-btn-ghost">
                      先頭から再開
                    </Link>
                  ) : null}
                </div>
              </form>
            );
          })}
        </div>
      </section>

      <StaticRebuildQueuePanel
        rows={rows}
        retryAllAction={retryAllFailedStaticRebuild}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number;
}): React.ReactElement {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <div className="fn-muted fn-text-sm">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{value}</div>
    </div>
  );
}
