"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { SaveSuccessNotice } from "@/components/ui/SaveSuccessNotice";
import { ManageXIcon } from "@/components/manage/ManageXIcon";
import {
  bulkUpsertEventStaffFromCsv,
  removeEventStaffMember,
  transferEventOwnershipAction,
  upsertEventStaffMember,
} from "@/lib/actions/event-staff-admin";
import {
  ALL_PERMISSION_KEYS,
  isAdminOnlyKey,
  type PermissionKey,
} from "@/lib/auth/permissions/keys";
import {
  getPresetPermissions,
  PRESET_DEFINITIONS,
  type EventStaffPreset,
} from "@/lib/auth/permissions/presets";
import {
  buildEventStaffCsvPreview,
  EVENT_STAFF_CSV_SAMPLE,
  eventStaffCsvPresetLabel,
} from "@/lib/admin/eventStaffCsv";

export interface EventStaffMemberRow {
  id: string;
  x_user_id: string;
  display_name: string;
  permission_preset: string | null;
  is_public: number | null;
  public_role_label: string | null;
  permission_keys: string[];
  x_name: string | null;
  icon_url: string | null;
}

interface EventStaffManagerProps {
  eventId: string;
  members: EventStaffMemberRow[];
  isSiteAdmin: boolean;
  variant?: "admin" | "manage";
}

const BASE_PRESETS: readonly EventStaffPreset[] = [
  "owner",
  "manager",
  "slot_manager",
  "content_editor",
  "reviewer",
  "public_staff",
  "custom",
];

function visiblePresets(isSiteAdmin: boolean): readonly EventStaffPreset[] {
  return isSiteAdmin ? [...BASE_PRESETS, "xid_reviewer"] : BASE_PRESETS;
}

function normalizePreset(value: string | null): EventStaffPreset {
  return visiblePresets(true).includes(value as EventStaffPreset)
    ? (value as EventStaffPreset)
    : "public_staff";
}

function permissionKeysForPreset(
  preset: EventStaffPreset,
  customKeys: readonly string[],
): string[] {
  return preset === "custom" ? [...customKeys] : [...getPresetPermissions(preset)];
}

export function EventStaffManager({
  eventId,
  members,
  isSiteAdmin,
  variant = "admin",
}: EventStaffManagerProps): React.ReactElement {
  const isManage = variant === "manage";
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<{
    message: string;
    pendingPublicReflection?: boolean;
  } | null>(null);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [showAddForm, setShowAddForm] = React.useState(false);

  const ownerCount = members.filter((row) => row.permission_preset === "owner").length;

  const run = (
    action: () => Promise<{
      ok: boolean;
      message?: string;
      pendingPublicReflection?: boolean;
    }>,
    okMessage = "保存しました。",
  ): void => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message ?? "操作に失敗しました。");
        return;
      }
      setSuccess({
        message: result.message ?? okMessage,
        pendingPublicReflection: result.pendingPublicReflection,
      });
      setShowAddForm(false);
      router.refresh();
    });
  };

  return (
    <div className="manage-permission-panel">
      {error ? (
        <p role="alert" className="fn-alert fn-alert--danger" style={{ margin: 0 }}>
          <Icon name="warning" size={13} aria-hidden /> {error}
        </p>
      ) : null}
      {success ? (
        <SaveSuccessNotice
          message={
            <>
              <Icon name="check" size={13} aria-hidden /> {success.message}
            </>
          }
          pendingPublicReflection={success.pendingPublicReflection}
          style={{ margin: 0, fontSize: 12 }}
        />
      ) : null}

      <section className="manage-permission-members">
        <div className="manage-staff-list-head">
          <h3 className="fn-console-card-title">登録メンバー ({members.length})</h3>
          {isManage ? (
            <button
              type="button"
              className="fn-btn fn-btn-primary fn-btn-sm"
              disabled={busy}
              onClick={() => {
                setShowAddForm((current) => !current);
                setExpandedId(null);
              }}
            >
              <Icon name="plus" size={12} aria-hidden />
              運営メンバーを追加
            </button>
          ) : null}
        </div>

        <ul className="manage-staff-list">
          {members.map((member) => {
            const preset = member.permission_preset;
            const presetLabel =
              preset && preset in PRESET_DEFINITIONS
                ? PRESET_DEFINITIONS[preset as keyof typeof PRESET_DEFINITIONS].label
                : "未設定";
            const displayName = member.x_name ?? member.display_name;
            const isExpanded = expandedId === member.id;

            return (
              <li key={member.id} className="manage-staff-list-item">
                <button
                  type="button"
                  className="manage-staff-list-row"
                  aria-expanded={isExpanded}
                  onClick={() =>
                    setExpandedId((current) =>
                      current === member.id ? null : member.id,
                    )
                  }
                >
                  <ManageXIcon
                    iconUrl={member.icon_url}
                    label={displayName}
                    size={36}
                  />
                  <span className="manage-staff-list-main">
                    <strong>{displayName}</strong>
                    <span className="manage-staff-list-xid">@{member.x_user_id}</span>
                  </span>
                  <span className="manage-staff-list-badges">
                    {preset === "owner" ? (
                      <span className="fn-badge fn-badge-warning">代表者</span>
                    ) : null}
                    <span className="fn-badge fn-badge-soft">{presetLabel}</span>
                    <span className="fn-badge fn-badge-neutral">
                      {member.is_public === 1 ? "公開" : "非公開"}
                    </span>
                  </span>
                  <Icon
                    name={isExpanded ? "chevron-up" : "chevron-down"}
                    size={14}
                    aria-hidden
                    className="manage-staff-list-chevron"
                  />
                </button>
                {isExpanded ? (
                  <MemberEditor
                    eventId={eventId}
                    member={member}
                    ownerCount={ownerCount}
                    isSiteAdmin={isSiteAdmin}
                    busy={busy}
                    onRun={run}
                    onClose={() => setExpandedId(null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {isManage && showAddForm ? (
        <AddMemberForm
          eventId={eventId}
          isSiteAdmin={isSiteAdmin}
          busy={busy}
          onRun={run}
          onCancel={() => setShowAddForm(false)}
        />
      ) : !isManage ? (
        <AddMemberForm
          eventId={eventId}
          isSiteAdmin={isSiteAdmin}
          busy={busy}
          onRun={run}
        />
      ) : null}

      {isManage ? (
        <details className="manage-collapsible manage-staff-advanced">
          <summary>詳細な管理（代表権移譲・CSV）</summary>
          <div className="manage-collapsible-body">
            <OwnershipTransferForm
              eventId={eventId}
              members={members}
              busy={busy}
              onRun={run}
            />
            <StaffCsvImport
              eventId={eventId}
              members={members}
              isSiteAdmin={isSiteAdmin}
              busy={busy}
              onRun={run}
            />
          </div>
        </details>
      ) : (
        <>
          <OwnershipTransferForm
            eventId={eventId}
            members={members}
            busy={busy}
            onRun={run}
          />
          <StaffCsvImport
            eventId={eventId}
            members={members}
            isSiteAdmin={isSiteAdmin}
            busy={busy}
            onRun={run}
          />
        </>
      )}
    </div>
  );
}

function MemberEditor({
  eventId,
  member,
  ownerCount,
  isSiteAdmin,
  busy,
  onRun,
  onClose,
}: {
  eventId: string;
  member: EventStaffMemberRow;
  ownerCount: number;
  isSiteAdmin: boolean;
  busy: boolean;
  onRun: (action: () => Promise<{ ok: boolean; message?: string }>) => void;
  onClose?: () => void;
}): React.ReactElement {
  const [preset, setPreset] = React.useState<EventStaffPreset>(() =>
    normalizePreset(member.permission_preset),
  );
  const [customKeys, setCustomKeys] = React.useState<string[]>(
    member.permission_keys,
  );
  const [showDelete, setShowDelete] = React.useState(false);
  const isLastOwner = member.permission_preset === "owner" && ownerCount === 1;

  return (
    <form
      className="manage-staff-editor"
      onSubmit={(event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        fd.set("event_id", eventId);
        fd.set("staff_id", member.id);
        fd.set("permission_preset", preset);
        fd.set(
          "permission_keys",
          preset === "custom" ? customKeys.join(",") : "",
        );
        onRun(() => upsertEventStaffMember(fd));
      }}
    >
      <input type="hidden" name="x_user_id" value={member.x_user_id} />
      <div className="manage-permission-fields">
        <label className="fn-label">
          表示名
          <input
            name="display_name"
            defaultValue={member.display_name}
            className="fn-input"
            required
            maxLength={80}
            disabled={busy}
          />
        </label>
        <label className="fn-label">
          担当プリセット
          <select
            value={preset}
            onChange={(event) => setPreset(event.target.value as EventStaffPreset)}
            className="fn-select"
            disabled={busy}
          >
            {visiblePresets(isSiteAdmin).map((option) => (
              <option
                key={option}
                value={option}
                disabled={isLastOwner && option !== "owner"}
              >
                {PRESET_DEFINITIONS[option].label}
              </option>
            ))}
          </select>
        </label>
        <label className="fn-label">
          公開状態
          <select
            name="is_public"
            defaultValue={String(member.is_public ?? 0)}
            className="fn-select"
            disabled={busy}
          >
            <option value="0">非公開</option>
            <option value="1">公開</option>
          </select>
        </label>
        <label className="fn-label">
          公開肩書
          <input
            name="public_role_label"
            defaultValue={member.public_role_label ?? ""}
            className="fn-input"
            maxLength={40}
            disabled={busy}
          />
        </label>
      </div>

      {preset === "custom" ? (
        <PermissionChecklist
          isSiteAdmin={isSiteAdmin}
          selected={customKeys}
          onChange={setCustomKeys}
          disabled={busy}
        />
      ) : (
        <p className="fn-console-note" style={{ margin: 0 }}>
          {PRESET_DEFINITIONS[preset].description}（
          {permissionKeysForPreset(preset, []).length}権限）
        </p>
      )}

      {isLastOwner ? (
        <p className="fn-alert fn-alert--danger" style={{ margin: 0 }}>
          最後の代表者は削除・降格できません。
        </p>
      ) : null}

      <div className="manage-staff-editor-meta">
        <label className="fn-label">
          変更理由
          <input name="reason" className="fn-input" required maxLength={500} />
        </label>
        <label className="fn-label">
          自己操作確認
          <input
            name="confirm_text"
            className="fn-input"
            placeholder={`SELF CHANGE ${eventId}`}
          />
        </label>
      </div>

      <div className="manage-staff-editor-actions">
        <button className="fn-btn fn-btn-primary fn-btn-sm" disabled={busy}>
          変更を保存
        </button>
        {onClose ? (
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={onClose}
          >
            閉じる
          </button>
        ) : null}
        <button
          type="button"
          className="fn-btn fn-btn-danger fn-btn-sm"
          disabled={busy || isLastOwner}
          title={
            isLastOwner
              ? "最後の代表者は削除できません。先に代表権限を移譲してください。"
              : undefined
          }
          onClick={() => setShowDelete((current) => !current)}
        >
          <Icon name="trash" size={12} aria-hidden /> 削除
        </button>
      </div>

      {showDelete && !isLastOwner ? (
        <div className="manage-staff-delete-panel">
          <p className="fn-console-note">
            @{member.x_user_id} を運営メンバーから削除します。
          </p>
          <button
            type="button"
            className="fn-btn fn-btn-danger fn-btn-sm"
            disabled={busy}
            onClick={() => {
              const fd = new FormData();
              fd.set("event_id", eventId);
              fd.set("staff_id", member.id);
              fd.set("reason", `イベントスタッフ ${member.x_user_id} を削除`);
              const confirmText = window.prompt(
                `自己操作の場合は REMOVE SELF ${eventId} を入力してください。対象外なら空欄で続行します。`,
                "",
              );
              if (confirmText === null) return;
              fd.set("confirm_text", confirmText);
              onRun(() => removeEventStaffMember(fd));
            }}
          >
            削除を確定
          </button>
        </div>
      ) : null}
    </form>
  );
}

function AddMemberForm({
  eventId,
  isSiteAdmin,
  busy,
  onRun,
  onCancel,
}: {
  eventId: string;
  isSiteAdmin: boolean;
  busy: boolean;
  onRun: (action: () => Promise<{ ok: boolean; message?: string }>) => void;
  onCancel?: () => void;
}): React.ReactElement {
  const [preset, setPreset] = React.useState<EventStaffPreset>("manager");
  const [customKeys, setCustomKeys] = React.useState<string[]>([]);
  return (
    <section className="manage-staff-add">
      <div className="manage-staff-add-head">
        <h3 className="fn-console-card-title">メンバーを追加</h3>
        {onCancel ? (
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={onCancel}
          >
            閉じる
          </button>
        ) : null}
      </div>
      <form
        className="manage-staff-add-form"
        onSubmit={(event) => {
          event.preventDefault();
          const fd = new FormData(event.currentTarget);
          fd.set("event_id", eventId);
          fd.set("permission_preset", preset);
          fd.set("permission_keys", preset === "custom" ? customKeys.join(",") : "");
          onRun(() => upsertEventStaffMember(fd));
        }}
      >
        <div className="manage-staff-add-fields">
          <input
            name="display_name"
            placeholder="表示名"
            className="fn-input"
            required
            maxLength={80}
          />
          <input
            name="x_user_id"
            placeholder="X ID（@なし）"
            className="fn-input"
            required
            pattern="[A-Za-z0-9_]{1,32}"
          />
          <select
            value={preset}
            onChange={(event) => setPreset(event.target.value as EventStaffPreset)}
            className="fn-select"
          >
            {visiblePresets(isSiteAdmin).map((option) => (
              <option key={option} value={option}>
                {PRESET_DEFINITIONS[option].label}
              </option>
            ))}
          </select>
          <select name="is_public" defaultValue="0" className="fn-select">
            <option value="0">非公開</option>
            <option value="1">公開</option>
          </select>
          <input
            name="public_role_label"
            placeholder="公開肩書"
            className="fn-input"
            maxLength={40}
          />
          <input
            name="reason"
            placeholder="追加理由"
            className="fn-input"
            required
            maxLength={500}
          />
        </div>
        {preset === "custom" ? (
          <PermissionChecklist
            isSiteAdmin={isSiteAdmin}
            selected={customKeys}
            onChange={setCustomKeys}
            disabled={busy}
          />
        ) : null}
        <button className="fn-btn fn-btn-primary" disabled={busy}>
          <Icon name="plus" size={12} aria-hidden /> 追加
        </button>
      </form>
    </section>
  );
}

function OwnershipTransferForm({
  eventId,
  members,
  busy,
  onRun,
}: {
  eventId: string;
  members: EventStaffMemberRow[];
  busy: boolean;
  onRun: (action: () => Promise<{ ok: boolean; message?: string }>) => void;
}): React.ReactElement | null {
  const owners = members.filter((member) => member.permission_preset === "owner");
  if (owners.length === 0 || members.length < 2) return null;
  return (
    <section className="manage-staff-advanced-section">
      <h3 className="fn-console-card-title">代表権限の移譲</h3>
      <form
        className="manage-staff-advanced-form"
        onSubmit={(event) => {
          event.preventDefault();
          const fd = new FormData(event.currentTarget);
          fd.set("event_id", eventId);
          onRun(() => transferEventOwnershipAction(fd));
        }}
      >
        <select name="from_staff_id" className="fn-select" required>
          {owners.map((member) => (
            <option key={member.id} value={member.id}>
              {member.display_name} (@{member.x_user_id})
            </option>
          ))}
        </select>
        <select name="to_staff_id" className="fn-select" required>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.display_name} (@{member.x_user_id})
            </option>
          ))}
        </select>
        <input name="reason" className="fn-input" placeholder="移譲理由" required />
        <input
          name="confirm_text"
          className="fn-input"
          placeholder={`TRANSFER ${eventId}`}
          required
        />
        <input
          name="self_confirm_text"
          className="fn-input"
          placeholder={`自己移譲時: SELF CHANGE ${eventId}`}
        />
        <button className="fn-btn fn-btn-danger" disabled={busy}>
          代表権限を移譲
        </button>
      </form>
    </section>
  );
}

function StaffCsvImport({
  eventId,
  members,
  isSiteAdmin,
  busy,
  onRun,
}: {
  eventId: string;
  members: EventStaffMemberRow[];
  isSiteAdmin: boolean;
  busy: boolean;
  onRun: (action: () => Promise<{ ok: boolean; message?: string }>) => void;
}): React.ReactElement {
  const [text, setText] = React.useState(EVENT_STAFF_CSV_SAMPLE);
  const [reason, setReason] = React.useState("スタッフCSV反映");
  const preview = React.useMemo(
    () =>
      buildEventStaffCsvPreview({
        text,
        existingSubjects: members.map((member) => ({ x_user_id: member.x_user_id })),
        isSiteAdmin,
      }),
    [text, members, isSiteAdmin],
  );
  return (
    <section className="manage-staff-advanced-section">
      <h3 className="fn-console-card-title">スタッフCSV</h3>
      <textarea
        className="fn-input"
        rows={7}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <p className="fn-console-note" style={{ margin: 0 }}>
        新規 {preview.counts.create} / 更新 {preview.counts.update} / エラー {preview.counts.error}
      </p>
      {preview.rows.slice(0, 10).map((row) => (
        <div key={row.lineNumber} className="fn-console-note">
          {row.lineNumber}行: {row.display_name} / @{row.x_user_id} / {eventStaffCsvPresetLabel(row.permission_preset)}
          {row.errors.length ? ` / ${row.errors.join("、")}` : ""}
        </div>
      ))}
      <input
        className="fn-input"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="反映理由"
      />
      <button
        type="button"
        className="fn-btn fn-btn-primary"
        disabled={busy || preview.hasErrors || !reason.trim()}
        onClick={() =>
          onRun(() =>
            bulkUpsertEventStaffFromCsv({
              eventId,
              reason,
              rows: preview.rows.filter((row) => row.errors.length === 0),
            }),
          )
        }
      >
        CSVを反映
      </button>
    </section>
  );
}

function PermissionChecklist({
  isSiteAdmin,
  selected,
  onChange,
  disabled,
}: {
  isSiteAdmin: boolean;
  selected: string[];
  onChange: (keys: string[]) => void;
  disabled: boolean;
}): React.ReactElement {
  const selectedSet = new Set(selected);
  const keys = ALL_PERMISSION_KEYS.filter(
    (key) => isSiteAdmin || !isAdminOnlyKey(key),
  );
  return (
    <div className="manage-permission-checklist">
      {keys.map((key: PermissionKey) => (
        <label key={key} className="fn-label">
          <input
            type="checkbox"
            checked={selectedSet.has(key)}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selectedSet, key]
                  : selected.filter((item) => item !== key),
              )
            }
          />{" "}
          {key}
        </label>
      ))}
    </div>
  );
}
