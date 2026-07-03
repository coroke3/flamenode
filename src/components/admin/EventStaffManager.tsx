"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { UserAvatar } from "@/components/user/UserAvatar";
import {
  addEventEditor,
  removeCollaborator,
  removeEventEditor,
  updateEventEditor,
  upsertCollaborator,
} from "@/lib/actions/event-staff-admin";
import {
  COLLABORATOR_PERMISSION_KEYS,
  COLLABORATOR_PERMISSION_LABELS,
} from "@/lib/constants/collaborator-permissions";
import { canonicalizePermissionKey } from "@/lib/auth/permissions/aliases";
import { isAdminOnlyKey, type PermissionKey } from "@/lib/auth/permissions/keys";
import {
  PRESET_DEFINITIONS,
  type EventStaffPreset,
} from "@/lib/auth/permissions/presets";

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
  permission_preset: string | null;
  is_public_staff: number | null;
  public_role_label: string | null;
  permission_keys: string[];
}

type CollaboratorPreset = Exclude<EventStaffPreset, "owner" | "manager">;

type CollaboratorCsvRow = {
  display_name: string;
  x_user_id: string;
  discord_user_id: string;
  permission_preset: CollaboratorPreset;
  permission_keys: string[];
  is_public_staff: string;
  public_role_label: string;
};

interface EventStaffManagerProps {
  eventId: string;
  editors: EditorRow[];
  collaborators: CollaboratorRow[];
  isSiteAdmin: boolean;
}

const COLLABORATOR_PRESETS: readonly CollaboratorPreset[] = [
  "public_staff",
  "slot_manager",
  "content_editor",
  "reviewer",
  "custom",
];

const ADMIN_COLLABORATOR_PRESETS: readonly CollaboratorPreset[] = [
  ...COLLABORATOR_PRESETS,
  "xid_reviewer",
];

function isCollaboratorPreset(value: string): value is CollaboratorPreset {
  return (ADMIN_COLLABORATOR_PRESETS as readonly string[]).includes(value);
}

function normalizeCollaboratorPreset(
  preset: string | null | undefined,
  permissionKeys: readonly string[],
): CollaboratorPreset {
  if (preset && isCollaboratorPreset(preset)) return preset;
  return permissionKeys.length > 0 ? "custom" : "public_staff";
}

function parseCsvAssignment(raw: string): {
  permission_preset: CollaboratorPreset;
  permission_keys: string[];
} {
  const value = raw.trim();
  if (!value) {
    return { permission_preset: "public_staff", permission_keys: [] };
  }
  if (isCollaboratorPreset(value)) {
    return { permission_preset: value, permission_keys: [] };
  }
  const keySource = value.startsWith("custom:")
    ? value.slice("custom:".length)
    : value;
  const permissionKeys = keySource
    .split(/[|;]/)
    .map((k) => k.trim())
    .filter(Boolean);
  return {
    permission_preset: permissionKeys.length > 0 ? "custom" : "public_staff",
    permission_keys: permissionKeys,
  };
}

function visibleCustomPermissionKeys(isSiteAdmin: boolean): PermissionKey[] {
  return COLLABORATOR_PERMISSION_KEYS.filter((key) => {
    const canonical = canonicalizePermissionKey(key);
    return canonical && (isSiteAdmin || !isAdminOnlyKey(canonical));
  }) as PermissionKey[];
}

function visiblePresetOptions(isSiteAdmin: boolean): readonly CollaboratorPreset[] {
  return isSiteAdmin ? ADMIN_COLLABORATOR_PRESETS : COLLABORATOR_PRESETS;
}

function parseCollaboratorCsv(raw: string): CollaboratorCsvRow[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => index !== 0 || !/^\uFEFF?表示名[,\t]/.test(line))
    .map((line, index) => {
      const cols = line.includes("\t")
        ? line.split("\t")
        : line.split(",").map((c) => c.trim());
      const [
        displayName = "",
        xUserId = "",
        maybeDiscordOrPermissions = "",
        maybePresetOrPermissions = "",
        maybePublicOrLabel = "0",
        maybeLabel = "",
      ] = cols;
      const usesLegacySixColumns = cols.length >= 6;
      const discordUserId = usesLegacySixColumns ? maybeDiscordOrPermissions : "";
      const assignmentSource = usesLegacySixColumns
        ? maybePresetOrPermissions
        : maybeDiscordOrPermissions;
      const isPublic = usesLegacySixColumns
        ? maybePublicOrLabel
        : maybePresetOrPermissions || "0";
      const roleLabel = usesLegacySixColumns ? maybeLabel : maybePublicOrLabel;
      const assignment = parseCsvAssignment(assignmentSource);
      return {
        display_name: displayName.trim() || `共同編集者 ${index + 1}`,
        x_user_id: xUserId.replace(/^@/, "").trim(),
        discord_user_id: discordUserId.trim(),
        permission_preset: assignment.permission_preset,
        permission_keys: assignment.permission_keys,
        is_public_staff: isPublic.trim() === "1" ? "1" : "0",
        public_role_label: roleLabel.trim(),
      };
    });
}

export function EventStaffManager({
  eventId,
  editors,
  collaborators,
  isSiteAdmin,
}: EventStaffManagerProps): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<
    | { kind: "editor"; xUserId: string }
    | { kind: "collaborator"; displayName: string; xUserId: string | null; discordId: string | null }
    | null
  >(null);

  const runAction = (
    fd: FormData,
    action: (fd: FormData) => Promise<{ ok: boolean; message?: string }>,
  ) => {
    setError(null);
    startTransition(async () => {
      const result = await action(fd);
      if (!result.ok) {
        setError(result.message ?? "更新に失敗しました。");
        return;
      }
      router.refresh();
    });
  };

  const runRemove = () => {
    if (!confirm) return;
    const target = confirm;
    setConfirm(null);
    const fd = new FormData();
    fd.set("event_id", eventId);
    if (target.kind === "editor") {
      fd.set("x_user_id", target.xUserId);
    } else {
      fd.set("x_user_id", target.xUserId ?? "");
      fd.set("discord_user_id", target.discordId ?? "");
    }
    setError(null);
    startTransition(async () => {
      const result =
        target.kind === "editor"
          ? await removeEventEditor(fd)
          : await removeCollaborator(fd);
      if (!result.ok) {
        setError(result.message ?? "削除に失敗しました。");
        return;
      }
      router.refresh();
    });
  };

  const runCollaboratorCsvImport = (rows: CollaboratorCsvRow[]) => {
    if (rows.length === 0) {
      setError("取り込める行がありません。");
      return;
    }
    setError(null);
    startTransition(async () => {
      for (const row of rows) {
        if (!isSiteAdmin && row.permission_preset === "xid_reviewer") {
          setError("X ID確認担当プリセットはsite adminだけが付与できます。");
          return;
        }
        const invalid = row.permission_keys.find(
          (key) => !canonicalizePermissionKey(key),
        );
        if (invalid) {
          setError(`存在しない権限キーが含まれています: ${invalid}`);
          return;
        }
        const blockedAdminOnly = row.permission_keys.find((key) => {
          const canonical = canonicalizePermissionKey(key);
          return canonical ? isAdminOnlyKey(canonical) : false;
        });
        if (!isSiteAdmin && blockedAdminOnly) {
          setError("site admin 専用権限はイベント運営者から付与できません。");
          return;
        }
        const fd = new FormData();
        fd.set("event_id", eventId);
        fd.set("display_name", row.display_name);
        fd.set("x_user_id", row.x_user_id);
        fd.set("discord_user_id", row.discord_user_id);
        fd.set("permission_preset", row.permission_preset);
        fd.set("permission_keys", row.permission_keys.join(","));
        fd.set("is_public_staff", row.is_public_staff);
        fd.set("public_role_label", row.public_role_label);
        const result = await upsertCollaborator(fd);
        if (!result.ok) {
          setError(result.message ?? `${row.display_name} の取り込みに失敗しました。`);
          return;
        }
      }
      router.refresh();
    });
  };

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {error ? (
        <p role="alert" className="fn-alert fn-alert--danger" style={{ margin: 0 }}>
          <Icon name="warning" size={13} aria-hidden /> {error}
        </p>
      ) : null}

      <section style={{ display: "grid", gap: 12 }}>
        <SectionHeading
          title={`代表・運営 (${editors.length})`}
          description="イベント全体を編集できるメンバーです。公開ページへの掲載有無もここで設定します。"
        />
        {editors.length === 0 ? (
          <EmptyState label="代表・運営はまだ登録されていません。" />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {editors.map((editor) => (
              <EditorForm
                key={editor.x_user_id}
                editor={editor}
                eventId={eventId}
                busy={busy}
                onSave={(fd) => runAction(fd, updateEventEditor)}
                onRemove={() => setConfirm({ kind: "editor", xUserId: editor.x_user_id })}
              />
            ))}
          </div>
        )}
        <AddEditorForm
          eventId={eventId}
          busy={busy}
          onSubmit={(fd) => runAction(fd, addEventEditor)}
        />
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <SectionHeading
          title={`共同編集権限 (${collaborators.length})`}
          description="全体権限ではなく、必要な編集項目だけを付与します。通常は X ID で紐付けます。"
        />
        {collaborators.length === 0 ? (
          <EmptyState label="共同編集権限を持つメンバーはまだ登録されていません。" />
        ) : (
          <CollaboratorPermissionMatrix
            eventId={eventId}
            collaborators={collaborators}
            isSiteAdmin={isSiteAdmin}
            busy={busy}
            onSave={(fd) => runAction(fd, upsertCollaborator)}
            onRemove={(collaborator) =>
              setConfirm({
                kind: "collaborator",
                displayName: collaborator.display_name,
                xUserId: collaborator.x_user_id,
                discordId: collaborator.discord_user_id,
              })
            }
          />
        )}
        <CollaboratorForm
          eventId={eventId}
          isSiteAdmin={isSiteAdmin}
          busy={busy}
          onSubmit={(fd) => runAction(fd, upsertCollaborator)}
          onImport={runCollaboratorCsvImport}
        />
      </section>

      <ConfirmDialog
        open={confirm !== null}
        title="メンバーを削除しますか?"
        message={
          confirm?.kind === "editor"
            ? `@${confirm.xUserId} の代表・運営権限を削除します。`
            : `${confirm?.displayName ?? "このメンバー"} の共同編集権限を削除します。`
        }
        confirmLabel="削除する"
        tone="danger"
        onConfirm={runRemove}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}): React.ReactElement {
  return (
    <div>
      <h3 className="fn-console-card-title" style={{ marginBottom: 4 }}>{title}</h3>
      <p className="fn-console-note">{description}</p>
    </div>
  );
}

function EmptyState({ label }: { label: string }): React.ReactElement {
  return (
    <div
      style={{
        padding: 14,
        border: "1px dashed var(--border-subtle)",
        borderRadius: "var(--radius-sm)",
        color: "var(--text-muted)",
        fontSize: 12,
      }}
    >
      {label}
    </div>
  );
}

function EditorForm({
  editor,
  eventId,
  busy,
  onSave,
  onRemove,
}: {
  editor: EditorRow;
  eventId: string;
  busy: boolean;
  onSave: (fd: FormData) => void;
  onRemove: () => void;
}): React.ReactElement {
  const displayName = editor.x_name ?? editor.x_user_id;
  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        onSave(new FormData(ev.currentTarget));
      }}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
        gap: 10,
        alignItems: "center",
        padding: 12,
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-base)",
      }}
    >
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="x_user_id" value={editor.x_user_id} />
      <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
        <MemberAvatar iconUrl={editor.icon_url} name={displayName} />
        <div style={{ minWidth: 0 }}>
          <strong style={{ display: "block", overflowWrap: "anywhere" }}>{displayName}</strong>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            @{editor.x_user_id}
          </span>
        </div>
      </div>
      <select name="role" defaultValue={editor.role ?? "editor"} className="fn-select" disabled={busy}>
        <option value="editor">運営</option>
        <option value="representative">代表</option>
      </select>
      <select name="is_public" defaultValue={String(editor.is_public ?? 1)} className="fn-select" disabled={busy}>
        <option value="1">公開する</option>
        <option value="0">非公開</option>
      </select>
      <div style={{ display: "grid", gap: 8 }}>
        <input
          type="text"
          name="public_role_label"
          defaultValue={editor.public_role_label ?? ""}
          placeholder="公開ラベル"
          className="fn-input"
          maxLength={40}
          disabled={busy}
        />
        <input
          type="text"
          name="internal_note"
          defaultValue={editor.internal_note ?? ""}
          placeholder="内部メモ"
          className="fn-input"
          maxLength={120}
          disabled={busy}
        />
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm" disabled={busy}>
          <Icon name="check" size={11} aria-hidden /> 保存
        </button>
        <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" disabled={busy} onClick={onRemove}>
          <Icon name="trash" size={11} aria-hidden />
        </button>
      </div>
    </form>
  );
}

function AddEditorForm({
  eventId,
  busy,
  onSubmit,
}: {
  eventId: string;
  busy: boolean;
  onSubmit: (fd: FormData) => void;
}): React.ReactElement {
  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        const form = ev.currentTarget;
        const fd = new FormData(form);
        fd.set("event_id", eventId);
        onSubmit(fd);
        form.reset();
      }}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))",
        gap: 8,
        padding: 12,
        border: "1px dashed var(--border-subtle)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <input
        type="text"
        name="x_user_id"
        placeholder="X ID (@なし)"
        className="fn-input"
        pattern="[A-Za-z0-9_]{1,32}"
        required
        disabled={busy}
      />
      <select name="role" defaultValue="editor" className="fn-select" disabled={busy}>
        <option value="editor">運営</option>
        <option value="representative">代表</option>
      </select>
      <select name="is_public" defaultValue="1" className="fn-select" disabled={busy}>
        <option value="1">公開する</option>
        <option value="0">非公開</option>
      </select>
      <input
        type="text"
        name="public_role_label"
        placeholder="公開ラベル"
        className="fn-input"
        maxLength={40}
        disabled={busy}
      />
      <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm" disabled={busy}>
        <Icon name="plus" size={11} aria-hidden /> 追加
      </button>
    </form>
  );
}

function CollaboratorCard({
  collaborator,
  busy,
  onRemove,
}: {
  collaborator: CollaboratorRow;
  busy: boolean;
  onRemove: () => void;
}): React.ReactElement {
  return (
    <article
      style={{
        display: "grid",
        gap: 10,
        padding: 12,
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-base)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ display: "block", overflowWrap: "anywhere" }}>{collaborator.display_name}</strong>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {collaborator.x_user_id ? `@${collaborator.x_user_id}` : ""}
            {collaborator.discord_user_id ? ` discord:${collaborator.discord_user_id.slice(0, 10)}...` : ""}
          </span>
        </div>
        <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" disabled={busy} onClick={onRemove}>
          <Icon name="trash" size={11} aria-hidden />
        </button>
      </div>
      <div className="fn-console-badge-row">
        <span className={collaborator.is_public_staff === 1 ? "fn-badge fn-badge-soft" : "fn-badge fn-badge-neutral"}>
          {collaborator.is_public_staff === 1 ? "公開" : "非公開"}
        </span>
        {collaborator.public_role_label ? (
          <span className="fn-badge fn-badge-neutral">{collaborator.public_role_label}</span>
        ) : null}
      </div>
      <div className="fn-console-badge-row">
        {collaborator.permission_keys.length === 0 ? (
          <span className="fn-muted fn-text-sm">権限なし</span>
        ) : (
          collaborator.permission_keys.map((key) => {
            const meta =
              COLLABORATOR_PERMISSION_LABELS[
                key as keyof typeof COLLABORATOR_PERMISSION_LABELS
              ];
            return (
              <span key={key} className="fn-badge fn-badge-soft" title={meta?.description ?? ""}>
                {meta?.label ?? "権限"}
              </span>
            );
          })
        )}
      </div>
    </article>
  );
}

function CollaboratorPermissionMatrix({
  eventId,
  collaborators,
  isSiteAdmin,
  busy,
  onSave,
  onRemove,
}: {
  eventId: string;
  collaborators: CollaboratorRow[];
  isSiteAdmin: boolean;
  busy: boolean;
  onSave: (fd: FormData) => void;
  onRemove: (collaborator: CollaboratorRow) => void;
}): React.ReactElement {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {collaborators.map((collaborator) => (
        <CollaboratorPermissionCard
          key={collaborator.key}
          eventId={eventId}
          collaborator={collaborator}
          isSiteAdmin={isSiteAdmin}
          busy={busy}
          onSave={onSave}
          onRemove={() => onRemove(collaborator)}
        />
      ))}
    </div>
  );
}

function CollaboratorPermissionCard({
  eventId,
  collaborator,
  isSiteAdmin,
  busy,
  onSave,
  onRemove,
}: {
  eventId: string;
  collaborator: CollaboratorRow;
  isSiteAdmin: boolean;
  busy: boolean;
  onSave: (fd: FormData) => void;
  onRemove: () => void;
}): React.ReactElement {
  const permissionSet = new Set(collaborator.permission_keys);
  const [preset, setPreset] = React.useState<CollaboratorPreset>(() =>
    normalizeCollaboratorPreset(
      collaborator.permission_preset,
      collaborator.permission_keys,
    ),
  );
  const customPermissionKeys = visibleCustomPermissionKeys(isSiteAdmin);
  const presetDefinition = PRESET_DEFINITIONS[preset];

  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.currentTarget);
        fd.set("event_id", eventId);
        fd.set("permission_preset", preset);
        fd.set(
          "permission_keys",
          preset === "custom"
            ? fd.getAll("permission_key").map(String).join(",")
            : "",
        );
        onSave(fd);
      }}
      style={{
        display: "grid",
        gap: 12,
        padding: 14,
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-base)",
      }}
    >
      <input type="hidden" name="display_name" value={collaborator.display_name} />
      <input type="hidden" name="x_user_id" value={collaborator.x_user_id ?? ""} />
      <input type="hidden" name="discord_user_id" value={collaborator.discord_user_id ?? ""} />

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ display: "block", overflowWrap: "anywhere" }}>
            {collaborator.display_name}
          </strong>
          <span
            style={{
              display: "block",
              marginTop: 2,
              fontSize: 11,
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {collaborator.x_user_id ? `@${collaborator.x_user_id}` : ""}
            {collaborator.discord_user_id
              ? `${collaborator.x_user_id ? " / " : ""}discord:${collaborator.discord_user_id.slice(0, 12)}...`
              : ""}
          </span>
        </div>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          disabled={busy}
          onClick={onRemove}
          aria-label={`${collaborator.display_name} を削除`}
        >
          <Icon name="trash" size={11} aria-hidden />
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select
          name="permission_preset"
          value={preset}
          onChange={(event) => setPreset(event.target.value as CollaboratorPreset)}
          className="fn-select"
          disabled={busy}
          style={{ minHeight: 30, fontSize: 12, width: "auto" }}
        >
          {visiblePresetOptions(isSiteAdmin).map((option) => (
            <option key={option} value={option}>
              {PRESET_DEFINITIONS[option].label}
            </option>
          ))}
        </select>
        <select
          name="is_public_staff"
          defaultValue={String(collaborator.is_public_staff ?? 0)}
          className="fn-select"
          disabled={busy}
          style={{ minHeight: 30, fontSize: 12, width: "auto" }}
        >
          <option value="0">非公開</option>
          <option value="1">公開</option>
        </select>
        <input
          type="text"
          name="public_role_label"
          defaultValue={collaborator.public_role_label ?? ""}
          placeholder="公開ラベル"
          className="fn-input"
          maxLength={40}
          disabled={busy}
          style={{ minHeight: 30, fontSize: 12, flex: 1, minWidth: 120 }}
        />
      </div>

      <p className="fn-console-note" style={{ margin: 0 }}>
        {presetDefinition.description}
      </p>

      {preset === "custom" ? (
        <PermissionChecklist
          keys={customPermissionKeys}
          selected={permissionSet}
          busy={busy}
        />
      ) : (
        <PresetPermissionPreview preset={preset} />
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm" disabled={busy}>
          保存
        </button>
      </div>
    </form>
  );
}

function PresetPermissionPreview({
  preset,
}: {
  preset: CollaboratorPreset;
}): React.ReactElement {
  const permissions = PRESET_DEFINITIONS[preset].permissions;
  if (permissions.length === 0) {
    return (
      <span className="fn-muted fn-text-sm">
        内部編集権限は付与されません。
      </span>
    );
  }
  return (
    <div className="fn-console-badge-row">
      {permissions.map((key) => {
        const meta = COLLABORATOR_PERMISSION_LABELS[key];
        return (
          <span key={key} className="fn-badge fn-badge-soft" title={meta.description}>
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}

function PermissionChecklist({
  keys,
  selected,
  busy,
}: {
  keys: readonly PermissionKey[];
  selected: ReadonlySet<string>;
  busy: boolean;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))",
        gap: 6,
      }}
    >
      {keys.map((key) => {
        const meta = COLLABORATOR_PERMISSION_LABELS[key];
        const checked = selected.has(key);
        return (
          <label
            key={key}
            title={meta.description}
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              padding: "6px 8px",
              borderRadius: "var(--radius-sm)",
              background: checked ? "var(--accent-primary-soft)" : "var(--bg-elevated)",
              cursor: busy ? "not-allowed" : "pointer",
              fontSize: 11,
              lineHeight: 1.3,
            }}
          >
            <input
              type="checkbox"
              name="permission_key"
              value={key}
              defaultChecked={checked}
              disabled={busy}
              style={{ flex: "0 0 auto" }}
            />
            <span style={{ overflowWrap: "anywhere" }}>{meta.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function CollaboratorForm({
  eventId,
  isSiteAdmin,
  busy,
  onSubmit,
  onImport,
}: {
  eventId: string;
  isSiteAdmin: boolean;
  busy: boolean;
  onSubmit: (fd: FormData) => void;
  onImport: (rows: CollaboratorCsvRow[]) => void;
}): React.ReactElement {
  const [permKeys, setPermKeys] = React.useState<string[]>([]);
  const [preset, setPreset] = React.useState<CollaboratorPreset>("public_staff");
  const [csvText, setCsvText] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const customPermissionKeys = visibleCustomPermissionKeys(isSiteAdmin);
  const toggle = (key: string) => {
    setPermKeys((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  };
  const copyCsvPrompt = async () => {
    const prompt = [
      "次の情報を FlameNode のイベント共同編集者CSVに整形してください。",
      "出力はCSV本文のみ。列は 表示名,X ID,Discord User ID,担当プリセット,公開フラグ,公開ラベル の6列です。",
      "担当プリセットは slot_manager,content_editor,reviewer,public_staff のいずれかを使ってください。",
      "X IDは@なし。公開する場合は1、それ以外は0にしてください。",
    ].join("\n");
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        const form = ev.currentTarget;
        const fd = new FormData(form);
        fd.set("event_id", eventId);
        fd.set("permission_preset", preset);
        fd.set("permission_keys", preset === "custom" ? permKeys.join(",") : "");
        onSubmit(fd);
        setPermKeys([]);
        setPreset("public_staff");
        form.reset();
      }}
      style={{
        display: "grid",
        gap: 12,
        padding: 12,
        border: "1px dashed var(--border-subtle)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <h4 style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>共同編集者を追加・更新</h4>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
          gap: 8,
        }}
      >
        <input
          type="text"
          name="display_name"
          placeholder="表示名"
          className="fn-input"
          required
          disabled={busy}
        />
        <input
          type="text"
          name="x_user_id"
          placeholder="X ID (@なし)"
          className="fn-input"
          pattern="[A-Za-z0-9_]{1,32}"
          disabled={busy}
        />
        <input
          type="text"
          name="discord_user_id"
          placeholder="Discord User ID"
          className="fn-input"
          inputMode="numeric"
          disabled={busy}
        />
        <select
          name="permission_preset"
          value={preset}
          onChange={(event) => setPreset(event.target.value as CollaboratorPreset)}
          className="fn-select"
          disabled={busy}
        >
          {visiblePresetOptions(isSiteAdmin).map((option) => (
            <option key={option} value={option}>
              {PRESET_DEFINITIONS[option].label}
            </option>
          ))}
        </select>
        <select name="is_public_staff" defaultValue="0" className="fn-select" disabled={busy}>
          <option value="0">非公開</option>
          <option value="1">公開メンバー</option>
        </select>
        <input
          type="text"
          name="public_role_label"
          placeholder="公開ラベル"
          className="fn-input"
          maxLength={40}
          disabled={busy}
        />
      </div>

      <p className="fn-console-note" style={{ margin: 0 }}>
        {PRESET_DEFINITIONS[preset].description}
      </p>

      {preset === "custom" ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))",
            gap: 8,
          }}
        >
          {customPermissionKeys.map((key) => {
            const meta = COLLABORATOR_PERMISSION_LABELS[key];
            const checked = permKeys.includes(key);
            return (
              <label
                key={key}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  padding: "9px 10px",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-sm)",
                  background: checked ? "var(--accent-primary-soft)" : "var(--bg-base)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(key)}
                  disabled={busy}
                  style={{ marginTop: 2 }}
                />
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", fontSize: 12 }}>{meta.label}</strong>
                  <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.45 }}>
                    {meta.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <PresetPermissionPreview preset={preset} />
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm" disabled={busy}>
          <Icon name="check" size={11} aria-hidden /> 追加・更新
        </button>
        {preset === "public_staff" ? (
          <span className="fn-muted fn-text-sm">
            権限未選択の場合は、公開メンバーとしての登録だけになります。
          </span>
        ) : null}
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
        <label className="fn-label" htmlFor="collaborator_csv">
          CSVでまとめて追加
        </label>
        <textarea
          id="collaborator_csv"
          className="fn-input"
          rows={5}
          value={csvText}
          onChange={(event) => setCsvText(event.target.value)}
          placeholder="例: 進行担当,yamada,,slot_manager,1,進行"
          disabled={busy}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" onClick={copyCsvPrompt} disabled={busy}>
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

function MemberAvatar({
  iconUrl,
  name,
}: {
  iconUrl: string | null;
  name: string;
}): React.ReactElement {
  return (
    <UserAvatar
      iconUrl={iconUrl}
      label={name}
      size={34}
      style={{ flex: "0 0 auto" } as React.CSSProperties}
    />
  );
}
