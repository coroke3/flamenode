import * as React from "react";import { FnTable } from "@/components/ui/FnTable";

import Link from "next/link";
import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  xIdMergeRequests,
  xIdMergeReverts,
} from "@/lib/db/schema";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Icon } from "@/components/ui/Icon";
import {
  approveXIdMergeRequest,
  createXIdMergeRequest,
  executeXIdMergeRequest,
  rejectXIdMergeRequest,
  rejectXIdMergeRevert,
} from "@/lib/actions/xid-merge-admin";
import {
  fetchXIdMergeImpact,
  summarizeMergeImpact,
  totalMergeImpact,
  type XIdMergeImpactItem,
} from "@/lib/admin/xIdMergeImpact";
import { formatUnix } from "@/lib/utils/format";

export const metadata: Metadata = { title: "X ID統合管理" };
export const dynamic = "force-dynamic";

async function createXIdMergeRequestAction(formData: FormData): Promise<void> {
  "use server";
  await createXIdMergeRequest(formData);
}

async function approveXIdMergeRequestAction(formData: FormData): Promise<void> {
  "use server";
  await approveXIdMergeRequest(formData);
}

async function rejectXIdMergeRequestAction(formData: FormData): Promise<void> {
  "use server";
  await rejectXIdMergeRequest(formData);
}

async function executeXIdMergeRequestAction(formData: FormData): Promise<void> {
  "use server";
  await executeXIdMergeRequest(formData);
}

async function rejectXIdMergeRevertAction(formData: FormData): Promise<void> {
  "use server";
  await rejectXIdMergeRevert(formData);
}

interface Props {
  searchParams?: Promise<{ view?: string }>;
}

export default async function AdminXIdMergesPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const sp = (await searchParams) ?? {};
  const view = sp.view === "reverts" ? "reverts" : "requests";
  const db = getDatabase();
  let requests: Array<typeof xIdMergeRequests.$inferSelect & {
    from_name: string | null;
    to_name: string | null;
    impact: XIdMergeImpactItem[];
  }> = [];
  let reverts: Array<typeof xIdMergeReverts.$inferSelect> = [];

  if (db) {
    const requestRows = await db
      .select()
      .from(xIdMergeRequests)
      .orderBy(desc(xIdMergeRequests.updated_at))
      .limit(50);
    const names = await Promise.all(
      requestRows.map(async (row, index) => {
        const shouldPreviewImpact =
          index < 20 && (row.status === "pending" || row.status === "approved");
        const impact = shouldPreviewImpact
          ? await fetchXIdMergeImpact(db, row.from_x_user_id)
          : [];
        return {
          ...row,
          from_name: null,
          to_name: null,
          impact,
        };
      }),
    );
    requests = names;
    reverts = await db
      .select()
      .from(xIdMergeReverts)
      .orderBy(desc(xIdMergeReverts.updated_at))
      .limit(100);
  }

  return (
    <div>
      <AdminPageHeader
        title="X ID統合管理"
        description="既存 X ID 同士の統合申請を、影響範囲の確認、承認、実行の順で扱います。自動実行はしません。"
      />

      <nav
        aria-label="X ID統合管理ビュー"
        style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}
      >
        <Link
          href="/admin/x-id-merges"
          className={`fn-btn fn-btn-sm ${view === "requests" ? "fn-btn-primary" : "fn-btn-ghost"}`}
        >
          統合申請
        </Link>
        <Link
          href="/admin/x-id-merges?view=reverts"
          className={`fn-btn fn-btn-sm ${view === "reverts" ? "fn-btn-primary" : "fn-btn-ghost"}`}
        >
          取り消し申請
        </Link>
      </nav>

      {view === "requests" ? (
        <>
          <section
            style={{
              marginTop: 18,
              padding: "16px 18px",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
              手動で統合申請を作成
            </h2>
            <form action={createXIdMergeRequestAction} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input name="from_x_user_id" className="fn-input fn-input-sm" placeholder="from X ID (@なし)" required />
              <input name="to_x_user_id" className="fn-input fn-input-sm" placeholder="to X ID (@なし)" required />
              <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm">
                <Icon name="plus" size={12} aria-hidden />
                申請作成
              </button>
            </form>
          </section>
          <MergeRequestTable rows={requests} />
        </>
      ) : (
        <RevertTable rows={reverts} />
      )}
    </div>
  );
}

function MergeRequestTable({
  rows,
}: {
  rows: Array<typeof xIdMergeRequests.$inferSelect & {
    from_name: string | null;
    to_name: string | null;
    impact: XIdMergeImpactItem[];
  }>;
}): React.ReactElement {
  return (
    <section style={{ marginTop: 22 }}>
      <FnTable>
        <thead>
          <tr>
            <th>状態</th>
            <th>from → to</th>
            <th>影響範囲</th>
            <th>更新</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const total = totalMergeImpact(row.impact);
            return (
              <tr key={row.id}>
                <td>
                  <span
                    className={`fn-badge ${
                      row.status === "done"
                        ? "fn-badge-accent"
                        : row.status === "approved"
                          ? "fn-badge-warning"
                          : row.status === "rejected"
                            ? "fn-badge-soft"
                            : "fn-badge-danger"
                    }`}
                  >
                    {row.status ?? "pending"}
                  </span>
                </td>
                <td>
                  <div>
                    <Link href={`/user/${encodeURIComponent(row.from_x_user_id)}`}>
                      @{row.from_x_user_id}
                    </Link>
                    {" → "}
                    <Link href={`/user/${encodeURIComponent(row.to_x_user_id)}`}>
                      @{row.to_x_user_id}
                    </Link>
                  </div>
                  <div className="fn-muted" style={{ fontSize: 11 }}>
                    {row.from_name ?? "?"} → {row.to_name ?? "?"}
                  </div>
                </td>
                <td>
                  {row.impact.length === 0 ? (
                    <span className="fn-muted fn-text-sm">完了/却下済みのため未計算</span>
                  ) : (
                    <details>
                      <summary>
                        {total.toLocaleString()} 行 / {summarizeMergeImpact(row.impact)}
                      </summary>
                      <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 12 }}>
                        {row.impact.map((item) => (
                          <li key={item.key}>
                            <code>{item.key}</code>: {item.count}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                <td className="fn-muted">{formatUnix(row.updated_at)}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {row.status === "pending" ? (
                      <>
                        <form action={approveXIdMergeRequestAction}>
                          <input type="hidden" name="id" value={row.id} />
                          <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm">
                            承認
                          </button>
                        </form>
                        <form action={rejectXIdMergeRequestAction}>
                          <input type="hidden" name="id" value={row.id} />
                          <button type="submit" className="fn-btn fn-btn-ghost fn-btn-sm">
                            却下
                          </button>
                        </form>
                      </>
                    ) : null}
                    {row.status === "approved" ? (
                      <form action={executeXIdMergeRequestAction} style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <input type="hidden" name="id" value={row.id} />
                        <input
                          name="confirm"
                          className="fn-input fn-input-sm"
                          placeholder="MERGE"
                          aria-label="確認文字列 MERGE"
                          required
                          style={{ width: 92 }}
                        />
                        <button type="submit" className="fn-btn fn-btn-danger fn-btn-sm">
                          実行
                        </button>
                      </form>
                    ) : null}
                    <Link
                      href={`/admin/audit?table=x_id_merge_requests&record=${encodeURIComponent(row.id)}`}
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                    >
                      監査
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: 18, textAlign: "center" }}>
                <span className="fn-muted fn-text-sm">X ID 統合申請はありません。</span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </FnTable>
    </section>
  );
}

function RevertTable({
  rows,
}: {
  rows: Array<typeof xIdMergeReverts.$inferSelect>;
}): React.ReactElement {
  return (
    <section style={{ marginTop: 22 }}>
      <FnTable>
        <thead>
          <tr>
            <th>状態</th>
            <th>merge request</th>
            <th>期限</th>
            <th>snapshot</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <span className={`fn-badge ${row.status === "pending" ? "fn-badge-danger" : "fn-badge-soft"}`}>
                  {row.status ?? "pending"}
                </span>
              </td>
              <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                {row.merge_request_id}
              </td>
              <td className="fn-muted">{formatUnix(row.revert_deadline_at)}</td>
              <td>
                <details>
                  <summary>restore snapshot を表示</summary>
                  <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11 }}>
                    {formatJson(row.restore_snapshot_json)}
                  </pre>
                </details>
              </td>
              <td>
                {row.status === "pending" ? (
                  <form action={rejectXIdMergeRevertAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <button type="submit" className="fn-btn fn-btn-ghost fn-btn-sm">
                      却下
                    </button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: 18, textAlign: "center" }}>
                <span className="fn-muted fn-text-sm">統合取り消し申請はありません。</span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </FnTable>
    </section>
  );
}

function formatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
