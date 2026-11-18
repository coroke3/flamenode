import * as React from "react";
import { AdminPermissionSettingsSchema, type AdminPermissionSettings } from "@flamenode/contracts";
import {
  GENERAL_EDITABLE_FIELD_KEYS, GENERAL_EDITABLE_FIELD_LABELS, GENERAL_EDITABLE_FIELD_HELP,
  parseGeneralEditableFields, type GeneralEditableFieldKey,
} from "@flamenode/domain/video";
import { sendAdminGuardedWrite } from "../../api/adminUserEdits.js";
import type { OpsFetch } from "../../api/read.js";

/**
 * MIG-0731 U01: CURRENT permissions are serialized as repeated checkbox keys,
 * so the Hono JSON boundary receives arrays, not a comma-separated string.
 * Labels track CURRENT generalEditPermissions; U04 validates the final schema.
 */
// Keep CURRENT legacy section-key expansion and exact field order from domain.
type Field = GeneralEditableFieldKey;
const fields = GENERAL_EDITABLE_FIELD_KEYS.map((key) =>
  [key, GENERAL_EDITABLE_FIELD_LABELS[key]] as const);
export function fieldsSetFromCsv(csv: string | null): Set<Field> {
  return parseGeneralEditableFields(csv);
}
function values(set: Set<Field>): Field[] {
  return GENERAL_EDITABLE_FIELD_KEYS.filter((name) => set.has(name));
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
/** A malformed API response must not overwrite a privileged policy editor. */
export function isValidPermissionSaveResponse(value: unknown): value is SaveResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.ok === "boolean" &&
    (row.message === undefined || typeof row.message === "string") &&
    (row.settings === undefined || AdminPermissionSettingsSchema.safeParse(row.settings).success);
}
/** The shared write transport does not classify 403. Preserve the forbidden signal here. */
export function createEditableFieldsMutations(fetchFn: OpsFetch = (path, init) => fetch(path, init)) {
  return {
    save: (payload: ReturnType<typeof permissionsPayload>) =>
      sendAdminGuardedWrite<SaveResponse>(
        fetchFn, "PUT", "/api/admin/permissions/editable-fields", payload,
      ),
  };
}
const writes = createEditableFieldsMutations();

/** Do not allow a second write before React has committed disabled=busy. */
export function acquirePermissionSaveLock(ref: { current: boolean }): boolean {
  if (ref.current) return false;
  ref.current = true;
  return true;
}
export function GlobalEditableFieldsPanel({
  settings, onSaved, onAccessRevoked,
}: { settings: AdminPermissionSettings; onSaved?: () => void; onAccessRevoked: (destination: "/entry" | "/dashboard") => void }): React.ReactElement {
  const [defaultFields, setDefaultFields] = React.useState(() => fieldsSetFromCsv(settings.default_editable_fields));
  const [upcomingFields, setUpcomingFields] = React.useState(() => fieldsSetFromCsv(settings.upcoming_editable_fields));
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const skipSync = React.useRef(false);
  React.useEffect(() => {
    if (busy) return;
    if (skipSync.current) { skipSync.current = false; return; }
    setDefaultFields(fieldsSetFromCsv(settings.default_editable_fields));
    setUpcomingFields(fieldsSetFromCsv(settings.upcoming_editable_fields));
  }, [settings.default_editable_fields, settings.upcoming_editable_fields, busy]);

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!acquirePermissionSaveLock(busyRef)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await writes.save(permissionsPayload(defaultFields, upcomingFields));
      if (result.status === "anonymous") {
        onAccessRevoked("/entry");
        return;
      }
      if (result.status === "forbidden") {
        onAccessRevoked("/dashboard");
        return;
      }
      if (result.status !== "ok" || !isValidPermissionSaveResponse(result.data)) {
        setError("通信に失敗しました。再度お試しください。");
        return;
      }
      if (!result.data.ok) {
        setError(result.data.message || "保存できませんでした。");
        return;
      }
      if (result.data.settings) {
        skipSync.current = true;
        setDefaultFields(fieldsSetFromCsv(result.data.settings.default_editable_fields));
        setUpcomingFields(fieldsSetFromCsv(result.data.settings.upcoming_editable_fields));
      }
      setMessage(result.data.message || "一般作品権限を保存しました。");
      onSaved?.();
    } catch {
      setError("保存処理を完了できませんでした。再度お試しください。");
    } finally {
      busyRef.current = false;
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
                  <span>
                    <strong style={{ display: "block" }}>{label}</strong>
                    <small className="fn-muted" style={{ display: "block" }}>
                      {GENERAL_EDITABLE_FIELD_HELP[field]}
                    </small>
                  </span>
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
