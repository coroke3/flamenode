"use client";

import * as React from "react";
import Link from "next/link";
import type { PermissionSimulationResult } from "@/lib/admin/permissionSimulator";
import { permissionMaskToKeys } from "@/lib/auth/permissions/mask";

interface PermissionSimulatorPanelProps {
  eventId: string;
  xUserId: string;
  discordUserId: string;
  result: PermissionSimulationResult | null;
}

export function PermissionSimulatorPanel({
  eventId,
  xUserId,
  discordUserId,
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
          />
        </label>
        <label className="fn-label">
          Discord User ID
          <input
            name="discord_user_id"
            className="fn-input"
            defaultValue={discordUserId}
            placeholder="数字のユーザーID"
          />
        </label>
        <button type="submit" className="fn-btn fn-btn-primary">
          権限をシミュレート
        </button>
      </form>

      <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
        X ID または Discord User ID のどちらか一方を入力してください。イベントスタッフ登録を参照します。
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
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>スタッフ情報</h2>
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr",
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
              <dd style={{ margin: 0 }}>{result.xUserId ? `@${result.xUserId}` : "—"}</dd>
              <dt className="fn-muted">Discord ID</dt>
              <dd style={{ margin: 0 }}>{result.discordUserId ?? "—"}</dd>
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
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>主要権限</h2>
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
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontSize: 12 }}>
                permission_mask 数値（詳細）
              </summary>
              <dl
                style={{
                  marginTop: 8,
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  gap: "4px 8px",
                  fontSize: 12,
                }}
              >
                <dt className="fn-muted">mask</dt>
                <dd style={{ margin: 0 }}>
                  <code>{result.permissionMask}</code> (0x
                  {result.permissionMask.toString(16)})
                </dd>
                <dt className="fn-muted">keys</dt>
                <dd style={{ margin: 0 }}>
                  <code>{permissionMaskToKeys(result.permissionMask).join(", ") || "—"}</code>
                </dd>
              </dl>
            </details>
          </section>
        </div>
      )}
    </div>
  );
}
