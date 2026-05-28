"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  addEventEditor,
  removeEventEditor,
  updateEventEditor,
  upsertCollaborator,
  removeCollaborator,
} from "@/lib/actions/event-staff-admin";
import {
  COLLABORATOR_PERMISSION_KEYS,
  COLLABORATOR_PERMISSION_LABELS,
} from "@/lib/constants/collaborator-permissions";

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

type CollaboratorCsvRow = {
  display_name: string;
  x_user_id: string;
  discord_user_id: string;
  permission_keys: string[];
  is_public_staff: string;
  public_role_label: string;
};

interface EventStaffManagerProps {
  eventId: string;
  editors: EditorRow[];
  collaborators: CollaboratorRow[];
}

function parseCollaboratorCsv(raw: string): CollaboratorCsvRow[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const cols = line.includes("\t")
        ? line.split("\t")
        : line.split(",").map((c) => c.trim());
      const [displayName = "", xUserId = "", discordUserId = "", permissionKeys = "", isPublic = "0", roleLabel = ""] =
        cols;
      return {
        display_name: displayName.trim() || `CSV collaborator ${index + 1}`,
        x_user_id: xUserId.replace(/^@/, "").trim(),
        discord_user_id: discordUserId.trim(),
        permission_keys: permissionKeys
          .split(/[|;]/)
          .map((k) => k.trim())
          .filter(Boolean),
        is_public_staff: isPublic.trim() === "1" ? "1" : "0",
        public_role_label: roleLabel.trim(),
      };
    });
}

export function EventStaffManager({
  eventId,
  editors,
  collaborators,
}: EventStaffManagerProps): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<
    | { kind: "editor"; xUserId: string }
    | { kind: "collaborator"; displayName: string; xUserId: string | null; discordId: string | null }
    | null
  >(null);

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

  const runCollaboratorCsvImport = (rows: CollaboratorCsvRow[]) => {
    if (rows.length === 0) {
      setError("取り込める CSV 行がありません。");
      return;
    }
    setError(null);
    startTransition(async () => {
      for (const row of rows) {
        const invalid = row.permission_keys.find(
          (key) => !COLLABORATOR_PERMISSION_KEYS.includes(
            key as (typeof COLLABORATOR_PERMISSION_KEYS)[number],
          ),
        );
        if (invalid) {
          setError(`選べない権限が含まれています: ${invalid}`);
          return;
        }
        const fd = new FormData();
        fd.set("event_id", eventId);
        fd.set("display_name", row.display_name);
        fd.set("x_user_id", row.x_user_id);
        fd.set("discord_user_id", row.discord_user_id);
        fd.set("permission_keys", row.permission_keys.join(","));
        fd.set("is_public_staff", row.is_public_staff);
        fd.set("public_role_label", row.public_role_label);
        const r = await upsertCollaborator(fd);
        if (!r.ok) {
          setError(r.message ?? `${row.display_name} の取り込みに失敗しました。`);
          return;
        }
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
          イベント管理者を登録/編集 (全体権限) ({editors.length})
        </h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          イベントの基本情報、予約枠、投稿フォーム、所属作品の運用設定を任せる人を登録します。
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
                      onClick={() => setConfirm({ kind: "editor", xUserId: e.x_user_id })}
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
            <Icon name="plus" size={11} aria-hidden /> イベント管理者を登録
          </button>
        </form>
      </section>

      <section>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          イベント管理者を登録/編集 (権限を選ぶ) ({collaborators.length})
        </h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          FlameNode全体の管理者ではない人にも、必要なイベント管理だけを許可できます。
          X ID または Discord User ID を指定し、既存の許可は選択した権限で上書きします。
          権限を 1 つも選ばずに登録すると、名前だけイベントスタッフ欄に掲載され、管理権限は付与されません。
        </p>
        {collaborators.length === 0 ? (
          <p className="fn-muted fn-text-sm">未登録です。</p>
        ) : (
          <table className="fn-table">
            <thead>
              <tr>
                <th>表示名 / ID</th>
                <th>付与権限</th>
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
                  <td style={{ fontSize: 11 }}>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 4,
                      }}
                    >
                      {c.permission_keys.length === 0 ? (
                        <span className="fn-muted">(なし)</span>
                      ) : (
                        c.permission_keys.map((k) => {
                          const meta =
                            COLLABORATOR_PERMISSION_LABELS[
                              k as keyof typeof COLLABORATOR_PERMISSION_LABELS
                            ];
                          return (
                            <span
                              key={k}
                              className="fn-badge fn-badge-soft"
                              title={meta?.description ?? k}
                              style={{ fontSize: 10 }}
                            >
                              {meta?.label ?? k}
                            </span>
                          );
                        })
                      )}
                    </div>
                  </td>
                  <td>{c.is_public_staff === 1 ? "公開" : "非公開"}</td>
                  <td>
                    <button
                      type="button"
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                      disabled={busy}
                      onClick={() =>
                        setConfirm({
                          kind: "collaborator",
                          displayName: c.display_name,
                          xUserId: c.x_user_id,
                          discordId: c.discord_user_id,
                        })
                      }
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
          onImport={runCollaboratorCsvImport}
        />
      </section>
    </div>
  );
}

function CollaboratorForm({
  eventId,
  busy,
  onSubmit,
  onImport,
}: {
  eventId: string;
  busy: boolean;
  onSubmit: (fd: FormData) => void;
  onImport: (rows: CollaboratorCsvRow[]) => void;
}): React.ReactElement {
  const [permKeys, setPermKeys] = React.useState<string[]>([]);
  const [csvText, setCsvText] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const toggle = (k: string) => {
    setPermKeys((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k],
    );
  };
  const copyCsvPrompt = async () => {
    const prompt = [
      "次の情報を FlameNode のイベント管理者 CSV に整形してください。",
      "出力は CSV 本文のみ。列順は 表示名,X ID,Discord User ID,権限,公開フラグ,公開ラベル の6列。",
      "権限は | 区切りで複数指定できます。",
      `権限は次から選んでください: ${COLLABORATOR_PERMISSION_KEYS.join(",")}`,
      "X ID は @ なし、Discord User ID が不明なら空欄、公開するなら5列目を 1、それ以外は 0 にしてください。",
    ].join("\n");
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
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
        イベント管理者を追加・更新
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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 8,
          marginBottom: 8,
        }}
      >
        {COLLABORATOR_PERMISSION_KEYS.map((k) => {
          const meta = COLLABORATOR_PERMISSION_LABELS[k];
          const checked = permKeys.includes(k);
          return (
            <label
              key={k}
              style={{
                display: "flex",
                gap: 6,
                fontSize: 12,
                alignItems: "flex-start",
                cursor: "pointer",
                padding: "8px 10px",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                background: checked
                  ? "var(--accent-primary-soft)"
                  : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(k)}
                style={{ marginTop: 2 }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: "block", fontSize: 12 }}>
                  {meta.label}
                </strong>
                <span
                  style={{
                    display: "block",
                    fontSize: 10.5,
                    color: "var(--text-muted)",
                    lineHeight: 1.4,
                  }}
                >
                  {meta.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <button
        type="submit"
        className="fn-btn fn-btn-primary fn-btn-sm"
        disabled={busy}
      >
        <Icon name="check" size={11} aria-hidden /> 追加・更新
      </button>
      {permKeys.length === 0 ? (
        <p style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
          ※ 権限を選んでいないため、名前だけイベントスタッフ欄に掲載されます (管理権限なし)。
        </p>
      ) : null}
      <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
        <label className="fn-label" htmlFor="collaborator_csv">
          CSV でまとめて追加
        </label>
        <textarea
          id="collaborator_csv"
          className="fn-input"
          rows={5}
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder="例: 進行担当,yamada,,event.basic|event.slots,1,進行"
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={copyCsvPrompt}
            disabled={busy}
          >
            <Icon name="copy" size={11} aria-hidden />
            {copied ? "コピーしました" : "CSV作成プロンプトをコピー"}
          </button>
          <button
            type="button"
            className="fn-btn fn-btn-primary fn-btn-sm"
            onClick={() => {
              const rows = parseCollaboratorCsv(csvText);
              onImport(rows);
              if (rows.length > 0) setCsvText("");
            }}
            disabled={busy || csvText.trim().length === 0}
          >
            <Icon name="upload" size={11} aria-hidden /> CSVを取り込む
          </button>
        </div>
      </div>
    </form>
  );
}
