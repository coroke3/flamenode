import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";

import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, lt } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  videoModerationCases,
  videos as videosTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AutoSubmitCheckbox, AutoSubmitSelect } from "@/components/forms/AutoSubmitSelect";
import { updateModerationCaseStatus } from "@/lib/actions/moderation-admin";
import { formatUnix } from "@/lib/utils/format";

export const metadata: Metadata = { title: "モデレーション" };
export const dynamic = "force-dynamic";

async function updateModerationCaseStatusAction(formData: FormData): Promise<void> {
  "use server";
  await updateModerationCaseStatus(formData);
}

const CASE_TYPES = ["x_reapply", "void", "duplicate", "rights", "operator"] as const;
const CASE_STATUSES = ["open", "resolved", "rejected", "expired", "cancelled"] as const;

interface Props {
  searchParams?: Promise<{ type?: string; status?: string; overdue?: string }>;
}

export default async function AdminModerationPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const sp = (await searchParams) ?? {};
  const typeFilter = CASE_TYPES.includes(sp.type as (typeof CASE_TYPES)[number])
    ? sp.type
    : "all";
  const statusFilter = CASE_STATUSES.includes(sp.status as (typeof CASE_STATUSES)[number])
    ? sp.status
    : "open";
  const overdueOnly = sp.overdue === "1";
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);
  let rows: Array<{
    id: string;
    video_id: string;
    case_type: string;
    status: string;
    public_reason: string | null;
    private_note: string | null;
    due_at: number | null;
    locked_until: number | null;
    attempt_count: number;
    related_x_user_id: string | null;
    created_by_user_id: string | null;
    resolved_by_user_id: string | null;
    created_at: number;
    resolved_at: number | null;
    video_title: string | null;
    video_status: string | null;
    related_x_name: string | null;
  }> = [];

  if (db) {
    const conds: SQL<unknown>[] = [];
    if (typeFilter !== "all") conds.push(eq(videoModerationCases.case_type, typeFilter as never));
    if (statusFilter !== "all") conds.push(eq(videoModerationCases.status, statusFilter as never));
    if (overdueOnly) {
      conds.push(lt(videoModerationCases.due_at, now));
    }
    const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
    const query = db
      .select({
        id: videoModerationCases.id,
        video_id: videoModerationCases.video_id,
        case_type: videoModerationCases.case_type,
        status: videoModerationCases.status,
        public_reason: videoModerationCases.public_reason,
        private_note: videoModerationCases.private_note,
        due_at: videoModerationCases.due_at,
        locked_until: videoModerationCases.locked_until,
        attempt_count: videoModerationCases.attempt_count,
        related_x_user_id: videoModerationCases.related_x_user_id,
        created_by_user_id: videoModerationCases.created_by_user_id,
        resolved_by_user_id: videoModerationCases.resolved_by_user_id,
        created_at: videoModerationCases.created_at,
        resolved_at: videoModerationCases.resolved_at,
        video_title: videosTable.title,
        video_status: videosTable.visibility_status,
        related_x_name: xUsersTable.x_name,
      })
      .from(videoModerationCases)
      .leftJoin(videosTable, eq(videosTable.id, videoModerationCases.video_id))
      .leftJoin(xUsersTable, eq(xUsersTable.id, videoModerationCases.related_x_user_id));
    rows = await (where ? query.where(where) : query)
      .orderBy(desc(videoModerationCases.created_at))
      .limit(100);
  }

  return (
    <div>
      <AdminPageHeader
        title="モデレーション"
        description="重複、権利、void、X ID再申請などの未解決ケースを最大100件表示します。closed case は必要時だけフィルタで開きます。"
      />

      <form method="get" style={{ marginTop: 14, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <AutoSubmitSelect name="type" className="fn-select" defaultValue={typeFilter}>
          <option value="all">type すべて</option>
          {CASE_TYPES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </AutoSubmitSelect>
        <AutoSubmitSelect name="status" className="fn-select" defaultValue={statusFilter}>
          <option value="all">status すべて</option>
          {CASE_STATUSES.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </AutoSubmitSelect>
        <label className="fn-btn fn-btn-ghost fn-btn-sm">
          <AutoSubmitCheckbox name="overdue" value="1" defaultChecked={overdueOnly} />
          期限切れのみ
        </label>
      </form>

      <section style={{ marginTop: 18 }}>
        <FnTable>
          <thead>
            <tr>
              <th>状態</th>
              <th>作品</th>
              <th>種別</th>
              <th>期限/ロック</th>
              <th>関連X ID</th>
              <th>理由/メモ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const overdue = row.status === "open" && row.due_at != null && row.due_at < now;
              return (
                <tr key={row.id}>
                  <td>
                    <span className={`fn-badge ${overdue ? "fn-badge-danger" : row.status === "open" ? "fn-badge-warning" : "fn-badge-soft"}`}>
                      {row.status}
                    </span>
                    <div className="fn-muted" style={{ fontSize: 11 }}>
                      attempt {row.attempt_count}
                    </div>
                  </td>
                  <td>
                    <Link href={`/admin/videos/${row.video_id}`}>
                      {row.video_title ?? row.video_id}
                    </Link>
                    <div className="fn-muted" style={{ fontSize: 11 }}>
                      {row.video_status ?? "video missing"}
                    </div>
                  </td>
                  <td><code>{row.case_type}</code></td>
                  <td className="fn-muted" style={{ fontSize: 11 }}>
                    <div>due: {row.due_at ? formatUnix(row.due_at) : "-"}</div>
                    <div>lock: {row.locked_until ? formatUnix(row.locked_until) : "-"}</div>
                  </td>
                  <td>
                    {row.related_x_user_id ? (
                      <Link href={`/user/${encodeURIComponent(row.related_x_user_id)}`}>
                        @{row.related_x_user_id}
                      </Link>
                    ) : (
                      "-"
                    )}
                    {row.related_x_name ? (
                      <div className="fn-muted" style={{ fontSize: 11 }}>{row.related_x_name}</div>
                    ) : null}
                  </td>
                  <td style={{ maxWidth: 320 }}>
                    <details>
                      <summary>理由とメモ</summary>
                      <p style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
                        公開理由: {row.public_reason || "-"}
                      </p>
                      <p style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
                        内部メモ: {row.private_note || "-"}
                      </p>
                    </details>
                  </td>
                  <td>
                    {row.status === "open" ? (
                      <form action={updateModerationCaseStatusAction} style={{ display: "grid", gap: 4, minWidth: 190 }}>
                        <input type="hidden" name="id" value={row.id} />
                        <select name="status" className="fn-select fn-input-sm" defaultValue="resolved">
                          <option value="resolved">解決</option>
                          <option value="rejected">却下</option>
                          <option value="cancelled">キャンセル</option>
                          <option value="expired">期限切れ</option>
                        </select>
                        <select name="video_status" className="fn-select fn-input-sm" defaultValue="">
                          <option value="">作品状態は変更しない</option>
                          <option value="pending">pending</option>
                          <option value="public">public</option>
                          <option value="voided">voided</option>
                          <option value="archived">archived</option>
                        </select>
                        <textarea
                          name="private_note"
                          className="fn-input"
                          rows={2}
                          placeholder="対応メモ"
                          maxLength={2000}
                        />
                        <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm">
                          更新
                        </button>
                      </form>
                    ) : (
                      <Link
                        href={`/admin/audit?table=video_moderation_cases&record=${encodeURIComponent(row.id)}`}
                        className="fn-btn fn-btn-ghost fn-btn-sm"
                      >
                        監査
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 18, textAlign: "center" }}>
                  <span className="fn-muted fn-text-sm">該当するケースはありません。</span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </FnTable>
      </section>
    </div>
  );
}
