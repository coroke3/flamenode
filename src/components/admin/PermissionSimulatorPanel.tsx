"use client";

import * as React from "react";
import Link from "next/link";
import type { PermissionSimulationResult } from "@/lib/admin/permissionSimulator";

interface PermissionSimulatorPanelProps {
  eventId: string;
  xUserId: string;
  result: PermissionSimulationResult | null;
}

export function PermissionSimulatorPanel({
  eventId,
  xUserId,
  result,
}: PermissionSimulatorPanelProps): React.ReactElement {
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <form method="get" className="fn-form-grid" style={{ maxWidth: 640 }}>
        <label className="fn-label">
          イベント ID
          <input
            name="event_id"
            className="fn-input"
            defaultValue={eventId}
            placeholder="evt_..."
            required
          />
        </label>
        <label className="fn-label">
          X ID
          <input
            name="x_user_id"
            className="fn-input"
            defaultValue={xUserId}
            placeholder="@screen_name"
            required
          />
        </label>
        <button type="submit" className="fn-btn fn-btn-primary">
          権限をシミュレート
        </button>
      </form>

      <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
        X IDを入力してください。イベントスタッフ登録の正本を参照します。
      </p>

      {!result ? (
        <p className="fn-muted">条件を入力してシミュレートしてください。</p>
      ) : !result.found ? (
        <p role="status" className="fn-muted">
          該当するスタッフ行が見つかりませんでした（event: <code>{result.eventId}</code>）。
        </p>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <section className="fn-card">
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
              スタッフ情報
            </h2>
            <dl className="admin-permission-result-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(120px, auto) 1fr",
                gap: "6px 12px",
                fontSize: 13,
              }}
            >
              <dt className="fn-muted">表示名</dt>
              <dd style={{ margin: 0 }}>{result.displayName ?? "—"}</dd>
              <dt className="fn-muted">プリセット</dt>
              <dd style={{ margin: 0 }}>
                <span className="fn-badge fn-badge-soft">{result.presetLabel}</span>{" "}
                <code>{result.preset}</code>
              </dd>
              <dt className="fn-muted">X ID</dt>
              <dd style={{ margin: 0 }}>
                {result.xUserId ? `@${result.xUserId}` : "—"}
              </dd>
            </dl>
            <p style={{ marginTop: 12 }}>
              <Link
                href={`/manage/events/${encodeURIComponent(result.eventId)}/staff`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                スタッフ管理へ
              </Link>
            </p>
          </section>

          <section className="fn-card">
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
              主要権限
            </h2>
            <table className="fn-table">
              <thead>
                <tr>
                  <th>権限</th>
                  <th>可否</th>
                </tr>
              </thead>
              <tbody>
                {result.spotlight.map((item) => (
                  <tr key={item.key}>
                    <td>{item.label}</td>
                    <td>
                      {item.allowed ? (
                        <span className="fn-badge fn-badge-accent">可</span>
                      ) : (
                        <span className="fn-badge fn-badge-soft">不可</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="fn-card">
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
              解決済み権限一覧（{result.resolvedKeys.length}）
            </h2>
            {result.resolvedKeys.length === 0 ? (
              <p className="fn-muted fn-text-sm">権限キーはありません。</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {result.resolvedLabels.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
