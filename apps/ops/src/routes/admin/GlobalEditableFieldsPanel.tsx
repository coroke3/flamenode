import * as React from "react";
import type { AdminPermissionSettings } from "@flamenode/contracts";
import { send } from "../../api/write.js";

/**
 * MIG-0731 U01: CURRENT permissions are serialized as repeated checkbox keys,
 * so the Hono JSON boundary receives arrays, not a comma-separated string.
 * Labels track CURRENT generalEditPermissions; U04 validates the final schema.
 */
const fields = [
  ["title", "タイトル"], ["youtube_url", "YouTube URL"],
  ["display_name", "表示名"], ["icon_url", "アイコン"],
  ["profile_text", "プロフィール文"], ["youtube_channel_url", "YouTubeチャンネルURL"],
  ["other_social_links", "SNS・外部リンク"], ["part", "部"],
  ["music", "楽曲"], ["music_reference_url", "楽曲参照URL"],
  ["credit", "クレジット"], ["intro_comment", "紹介コメント"],
  ["used_software", "使用ソフト"], ["highlights", "見どころ"],
  ["production_story", "制作エピソード"], ["closing_comment", "締めコメント"],
  ["custom_answers", "カスタム質問の回答"], ["stage_permission", "ステージ・権利確認の回答"],
  ["event_ids", "所属イベント"], ["is_collab", "合作状態"],
  ["members", "メンバー"], ["chapters", "チャプター"],
] as const;
type Field = (typeof fields)[number][0];
const allowed = new Set<string>(fields.map(([key]) => key));
function fromCsv(csv: string | null): Set<Field> {
  return new Set((csv ?? "").split(",").map(s => s.trim()).filter(s => allowed.has(s)) as Field[]);
}
function values(set: Set<Field>): Field[] {
  return fields.map(([name]) => name).filter((name) => set.has(name));
}
export function permissionsPayload(defaultFields: Set<Field>, upcomingFields: Set<Field>) {
  return {
    default_editable_fields: values(defaultFields),
    upcoming_editable_fields: values(upcomingFields),
  };
}
type SaveResponse = {
  ok: boolean;
  message?: string;
  settings?: AdminPermissionSettings;
};
export function GlobalEditableFieldsPanel({
  settings, onSaved,
}: { settings: AdminPermissionSettings; onSaved?: () => void }): React.ReactElement {
  const [defaultFields, setDefaultFields] = React.useState(() => fromCsv(settings.default_editable_fields));
  const [upcomingFields, setUpcomingFields] = React.useState(() => fromCsv(settings.upcoming_editable_fields));
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const skipSync = React.useRef(false);
  React.useEffect(() => {
    if (busy) return;
    if (skipSync.current) { skipSync.current = false; return; }
    setDefaultFields(fromCsv(settings.default_editable_fields));
    setUpcomingFields(fromCsv(settings.upcoming_editable_fields));
  }, [settings.default_editable_fields, settings.upcoming_editable_fields, busy]);

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await send<SaveResponse>(
        (path, init) => fetch(path, init),
        "PUT",
        "/api/admin/permissions/editable-fields",
        permissionsPayload(defaultFields, upcomingFields),
      );
      if (result.status === "anonymous") {
        window.location.assign("/entry");
        return;
      }
      if (result.status !== "ok" || !result.data.ok) {
        setError(result.status === "ok"
          ? (result.data.message || "保存できませんでした。")
          : "通信に失敗しました。再度お試しください。");
        return;
      }
      if (result.data.settings) {
        skipSync.current = true;
        setDefaultFields(fromCsv(result.data.settings.default_editable_fields));
        setUpcomingFields(fromCsv(result.data.settings.upcoming_editable_fields));
      }
      setMessage(result.data.message || "一般作品権限を保存しました。");
      onSaved?.();
    } finally {
      setBusy(false);
    }
  }
  const scopes = [
    { key: "default_editable_fields", label: "通常作品", selected: defaultFields, setter: setDefaultFields },
    { key: "upcoming_editable_fields", label: "公開前作品", selected: upcomingFields, setter: setUpcomingFields },
  ] as const;
  return (
    <section className="fn-card" style={{ marginTop: 18, padding: 24 }}>
      <h2>一般作品の編集権限</h2>
      <p className="fn-muted">チェックした項目を作品所有者が通常権限で編集できます。</p>
      <form onSubmit={(event) => { void save(event); }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 16 }}>
          {scopes.map((scope) => (
            <fieldset key={scope.key} disabled={busy} style={{ border: "1px solid var(--border-subtle)", padding: 12 }}>
              <legend>{scope.label}</legend>
              {fields.map(([field, label]) => (
                <label key={field} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                  <input type="checkbox" name={scope.key} value={field} checked={scope.selected.has(field)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      scope.setter((previous) => {
                        const next = new Set(previous);
                        if (checked) next.add(field); else next.delete(field);
                        return next;
                      });
                    }} />
                  {label}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        {error ? <p role="alert" className="fn-text-danger">{error}</p> : null}
        {message ? <p role="status">{message}</p> : null}
        <button type="submit" className="fn-btn fn-btn-primary" disabled={busy}>
          {busy ? "保存中..." : "保存"}
        </button>
      </form>
    </section>
  );
}
