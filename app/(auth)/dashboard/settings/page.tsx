import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  xAccountLinkRequests as linkReqTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guard";
import { Icon } from "@/components/ui/Icon";
import {
  SetActiveXButton,
  XIdLinkForm,
} from "@/components/settings/XIdSettingsClient";
import { formatUnix } from "@/lib/utils/format";

export const metadata: Metadata = { title: "設定" };
export const dynamic = "force-dynamic";

export default async function SettingsPage(): Promise<React.ReactElement> {
  const guard = await requireSession();
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  const xIds = db
    ? await db
        .select()
        .from(xUsersTable)
        .where(eq(xUsersTable.linked_discord_user_id, user.id))
    : [];

  const pendingLinkRequests = db
    ? await db
        .select()
        .from(linkReqTable)
        .where(
          and(
            eq(linkReqTable.discord_user_id, user.id),
            eq(linkReqTable.status, "pending"),
          )!,
        )
        .orderBy(desc(linkReqTable.requested_at))
    : [];

  return (
    <div
      style={{
        width: "min(96%, 800px)",
        margin: "0 auto",
        padding: "28px 16px 64px",
      }}
    >
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.04em" }}>
          設定
        </h1>
        <p style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>
          X ID 連携、アクティブ X ID の切替、Discord アカウント情報を管理します。
        </p>
      </header>

      <section className="fn-card fn-mb-lg">
        <div className="fn-card-header">
          <h2 className="fn-card-title">Discord</h2>
        </div>
        <div className="fn-card-body">
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            {user.image ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={user.image}
                alt=""
                width={48}
                height={48}
                style={{ borderRadius: 999, objectFit: "cover" }}
              />
            ) : (
              <span
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 999,
                  background: "var(--bg-elevated)",
                  display: "grid",
                  placeItems: "center",
                  color: "var(--text-muted)",
                }}
              >
                <Icon name="user" size={20} aria-hidden />
              </span>
            )}
            <div>
              <div style={{ fontWeight: 700 }}>{user.name}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                ID: {user.id}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="fn-card">
        <div className="fn-card-header">
          <h2 className="fn-card-title">連携 X ID</h2>
        </div>
        <div className="fn-card-body">
          <XIdLinkForm />
          <p className="fn-muted fn-text-sm" style={{ marginTop: 12 }}>
            申請後は運営（管理者）の承認が必要です。管理者の方は{" "}
            <Link href="/admin/x-link-requests">X 連携申請</Link> から承認できます。
          </p>

          {pendingLinkRequests.length > 0 ? (
            <div style={{ marginTop: 20 }}>
              <h3
                className="fn-text-sm"
                style={{
                  margin: "0 0 8px",
                  fontWeight: 700,
                  color: "var(--text-secondary)",
                }}
              >
                承認待ちの申請
              </h3>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: "1.1em",
                  fontSize: 13,
                  color: "var(--text-muted)",
                }}
              >
                {pendingLinkRequests.map((r) => (
                  <li key={r.id}>
                    @{r.requested_x_id}
                    <span style={{ opacity: 0.75 }}>
                      {" "}
                      · {formatUnix(r.requested_at, { dateOnly: true })}{" "}
                      {formatUnix(r.requested_at, { timeOnly: true })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {xIds.length === 0 ? (
            <p
              className="fn-muted fn-text-sm"
              style={{ marginTop: pendingLinkRequests.length ? 16 : 20 }}
            >
              承認済みの X ID はまだありません。
              <br />
              上のフォームから連携を申請するか、運営の承認をお待ちください。
            </p>
          ) : (
            <table className="fn-table">
              <thead>
                <tr>
                  <th>名前</th>
                  <th>@ID</th>
                  <th>状態</th>
                  <th>アクティブ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {xIds.map((x) => (
                  <tr key={x.id}>
                    <td>{x.x_name}</td>
                    <td>@{x.id}</td>
                    <td>
                      {x.approval_status === "approved" ? (
                        <span className="fn-badge fn-badge-accent">承認済</span>
                      ) : x.approval_status === "pending" ? (
                        <span className="fn-badge fn-badge-warning">承認待ち</span>
                      ) : (
                        <span className="fn-badge fn-badge-danger">再申請</span>
                      )}
                    </td>
                    <td>
                      {x.id === user.active_x_user_id ? (
                        <Icon name="check" size={14} aria-label="アクティブ" />
                      ) : x.approval_status === "approved" ? (
                        <SetActiveXButton xUserId={x.id} />
                      ) : (
                        <span className="fn-muted fn-text-sm">—</span>
                      )}
                    </td>
                    <td>
                      <Link
                        href={`/user/${x.id}`}
                        className="fn-btn fn-btn-ghost fn-btn-sm"
                      >
                        プロフィール
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
