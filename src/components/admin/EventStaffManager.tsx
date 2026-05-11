"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import {
  addEventEditor,
  removeEventEditor,
  updateEventEditor,
  upsertCollaborator,
  removeCollaborator,
} from "@/lib/actions/event-staff-admin";
import { COLLABORATOR_PERMISSION_KEYS } from "@/lib/constants/collaborator-permissions";

export interface EditorRow {
  x_user_id: string;
  role: "editor" | "representative" | null;
  is_public: number | null;
  public_role_label: string | null;
  internal_note: string | null;
  x_name: string | null;
  icon_url: string | null;
}

export interface CollaboratorRow {
  key: string;
  x_user_id: string | null;
  discord_user_id: string | null;
  display_name: string;
  is_public_staff: number | null;
  public_role_label: string | null;
  permission_keys: string[];
}

interface EventStaffManagerProps {
  eventId: string;
  editors: EditorRow[];
  collaborators: CollaboratorRow[];
}

export function EventStaffManager({
  eventId,
  editors,
  collaborators,
}: EventStaffManagerProps): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const runAction = (fd: FormData, action: (fd: FormData) => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const r = await action(fd);
      if (!r.ok) {
        setError(r.message ?? "操作に失敗しました。");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 12 }}>
          <Icon name="warning" size={12} aria-hidden /> {error}
        </p>
      ) : null}

      <section>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          イベント編集者 ({editors.length})
        </h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          編集者は、担当イベントの基本情報・枠・運営メンバー・所属作品を全て編集できます。
        </p>
        {editors.length === 0 ? (
          <p className="fn-muted fn-text-sm">未登録です。</p>
        ) : (
          <table className="fn-table">
            <thead>
              <tr>
                <th>X ID</th>
                <th>表示名</th>
                <th>役割</th>
                <th>公開</th>
                <th>公開ラベル</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {editors.map((e) => (
                <tr key={e.x_user_id}>
                  <td>@{e.x_user_id}</td>
                  <td>{e.x_name ?? e.x_user_id}</td>
                  <td>
                    <select
                      defaultValue={e.role ?? "editor"}
                      onChange={(ev) => {
                        const fd = new FormData();
                        fd.set("event_id", eventId);
                        fd.set("x_user_id", e.x_user_id);
                        fd.set("role", ev.target.value);
                        fd.set("is_public", String(e.is_public ?? 1));
                        fd.set("public_role_label", e.public_role_label ?? "");
                        fd.set("internal_note", e.internal_note ?? "");
                        runAction(fd, updateEventEditor);
                      }}
                      className="fn-select"
                      disabled={busy}
                    >
                      <option value="editor">editor</option>
                      <option value="representative">representative</option>
                    </select>
                  </td>
                  <td>
                    <select
                      defaultValue={String(e.is_public ?? 1)}
                      onChange={(ev) => {
                        const fd = new FormData();
                        fd.set("event_id", eventId);
                        fd.set("x_user_id", e.x_user_id);
                        fd.set("role", e.role ?? "editor");
                        fd.set("is_public", ev.target.value);
                        fd.set("public_role_label", e.public_role_label ?? "");
                        fd.set("internal_note", e.internal_note ?? "");
                        runAction(fd, updateEventEditor);
                      }}
                      className="fn-select"
                      disabled={busy}
                    >
                      <option value="1">公開</option>
                      <option value="0">非公開</option>
                    </select>
                  </td>
                  <td>{e.public_role_label ?? "-"}</td>
                  <td>
                    <button
                      type="button"
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                      disabled={busy}
                      onClick={() => {
                        if (!confirm(`@${e.x_user_id} を編集者から外しますか?`)) return;
                        const fd = new FormData();
                        fd.set("event_id", eventId);
                        fd.set("x_user_id", e.x_user_id);
                        runAction(fd, removeEventEditor);
                      }}
                    >
                      <Icon name="trash" size={11} aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            const fd = new FormData(ev.currentTarget);
            fd.set("event_id", eventId);
            runAction(fd, addEventEditor);
            ev.currentTarget.reset();
          }}
          style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          <input
            type="text"
            name="x_user_id"
            placeholder="X ID (@抜き)"
            className="fn-input"
            style={{ width: 160 }}
            pattern="[A-Za-z0-9_]{1,32}"
            required
          />
          <select name="role" defaultValue="editor" className="fn-select">
            <option value="editor">editor</option>
            <option value="representative">representative</option>
          </select>
          <select name="is_public" defaultValue="1" className="fn-select">
            <option value="1">公開</option>
            <option value="0">非公開</option>
          </select>
          <input
            type="text"
            name="public_role_label"
            placeholder="公開ラベル"
            className="fn-input"
            maxLength={40}
            style={{ width: 140 }}
          />
          <button
            type="submit"
            className="fn-btn fn-btn-primary fn-btn-sm"
            disabled={busy}
          >
            <Icon name="plus" size={11} aria-hidden /> 編集者追加
          </button>
        </form>
      </section>

      <section>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          協力者 (permission_key 細粒度許可) ({collaborators.length})
        </h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          協力者は permission_key 単位で操作を許可されます。
          複数の権限はカンマ区切りで指定し、既存の許可は上書きされます。
        </p>
        {collaborators.length === 0 ? (
          <p className="fn-muted fn-text-sm">未登録です。</p>
        ) : (
          <table className="fn-table">
            <thead>
              <tr>
                <th>表示名 / ID</th>
                <th>付与 permission_key</th>
                <th>公開</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {collaborators.map((c) => (
                <tr key={c.key}>
                  <td>
                    <strong>{c.display_name}</strong>
                    <br />
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {c.x_user_id ? `@${c.x_user_id}` : ""}
                      {c.discord_user_id ? ` discord:${c.discord_user_id.slice(0, 10)}…` : ""}
                    </span>
                  </td>
                  <td style={{ fontSize: 11 }}>{c.permission_keys.join(", ")}</td>
                  <td>{c.is_public_staff === 1 ? "公開" : "非公開"}</td>
                  <td>
                    <button
                      type="button"
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                      disabled={busy}
                      onClick={() => {
                        if (!confirm(`${c.display_name} を協力者から外しますか?`)) return;
                        const fd = new FormData();
                        fd.set("event_id", eventId);
                        if (c.x_user_id) fd.set("x_user_id", c.x_user_id);
                        if (c.discord_user_id) fd.set("discord_user_id", c.discord_user_id);
                        runAction(fd, removeCollaborator);
                      }}
                    >
                      <Icon name="trash" size={11} aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <CollaboratorForm
          eventId={eventId}
          busy={busy}
          onSubmit={(fd) => runAction(fd, upsertCollaborator)}
        />
      </section>
    </div>
  );
}

function CollaboratorForm({
  eventId,
  busy,
  onSubmit,
}: {
  eventId: string;
  busy: boolean;
  onSubmit: (fd: FormData) => void;
}): React.ReactElement {
  const [permKeys, setPermKeys] = React.useState<string[]>([]);
  const toggle = (k: string) => {
    setPermKeys((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k],
    );
  };
  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.currentTarget);
        fd.set("event_id", eventId);
        fd.set("permission_keys", permKeys.join(","));
        onSubmit(fd);
        setPermKeys([]);
        ev.currentTarget.reset();
      }}
      style={{
        marginTop: 14,
        padding: 12,
        border: "1px dashed var(--border-subtle)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
        協力者を追加・更新
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <input
          type="text"
          name="display_name"
          placeholder="表示名 (例: スタッフA)"
          className="fn-input"
          style={{ minWidth: 160 }}
          required
        />
        <input
          type="text"
          name="x_user_id"
          placeholder="X ID (任意)"
          className="fn-input"
          style={{ width: 140 }}
          pattern="[A-Za-z0-9_]{1,32}"
        />
        <input
          type="text"
          name="discord_user_id"
          placeholder="Discord User ID (任意)"
          className="fn-input"
          style={{ width: 180 }}
        />
        <select name="is_public_staff" defaultValue="0" className="fn-select">
          <option value="0">非公開</option>
          <option value="1">公開メンバー</option>
        </select>
        <input
          type="text"
          name="public_role_label"
          placeholder="公開ラベル"
          className="fn-input"
          maxLength={40}
          style={{ width: 140 }}
        />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {COLLABORATOR_PERMISSION_KEYS.map((k) => (
          <label
            key={k}
            style={{
              display: "inline-flex",
              gap: 4,
              fontSize: 11,
              alignItems: "center",
              cursor: "pointer",
              padding: "2px 6px",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              background: permKeys.includes(k)
                ? "var(--accent-primary-soft)"
                : "transparent",
            }}
          >
            <input
              type="checkbox"
              checked={permKeys.includes(k)}
              onChange={() => toggle(k)}
            />
            {k}
          </label>
        ))}
      </div>
      <button
        type="submit"
        className="fn-btn fn-btn-primary fn-btn-sm"
        disabled={busy || permKeys.length === 0}
      >
        <Icon name="check" size={11} aria-hidden /> 追加・更新
      </button>
    </form>
  );
}
