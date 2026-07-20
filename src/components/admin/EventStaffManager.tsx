"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
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
}: EventStaffManagerProps): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState<string | null>(null);

  const run = (
    action: () => Promise<{ ok: boolean; message?: string }>,
  ): void => {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setMessage(result.message ?? "操作に失敗しました。");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div style={{ display: "grid", gap: 22 }}>
      {message ? (
        <p role="alert" className="fn-alert fn-alert--danger" style={{ margin: 0 }}>
          <Icon name="warning" size={13} aria-hidden /> {message}
        </p>
      ) : null}

      <section style={{ display: "grid", gap: 10 }}>
        <h3 className="fn-console-card-title">登録メンバー ({members.length})</h3>
        {members.map((member) => (
          <MemberEditor
            key={member.id}
            eventId={eventId}
            member={member}
            ownerCount={members.filter((row) => row.permission_preset === "owner").length}
            isSiteAdmin={isSiteAdmin}
            busy={busy}
            onRun={run}
          />
        ))}
      </section>

      <AddMemberForm
        eventId={eventId}
        isSiteAdmin={isSiteAdmin}
        busy={busy}
        onRun={run}
      />

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
  );
}

function MemberEditor({
  eventId,
  member,
  ownerCount,
  isSiteAdmin,
  busy,
  onRun,
}: {
  eventId: string;
  member: EventStaffMemberRow;
  ownerCount: number;
  isSiteAdmin: boolean;
  busy: boolean;
  onRun: (action: () => Promise<{ ok: boolean; message?: string }>) => void;
}): React.ReactElement {
  const [preset, setPreset] = React.useState<EventStaffPreset>(() =>
    normalizePreset(member.permission_preset),
  );
  const [customKeys, setCustomKeys] = React.useState<string[]>(
    member.permission_keys,
  );
  const isLastOwner = member.permission_preset === "owner" && ownerCount === 1;

  return (
    <form
      className="fn-card"
      style={{ padding: 14, display: "grid", gap: 12 }}
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
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <strong>{member.x_name ?? member.display_name}</strong>
          <div className="fn-muted" style={{ fontSize: 11 }}>
            @{member.x_user_id}
          </div>
          {member.permission_preset === "owner" ? (
            <span className="fn-badge fn-badge-warning">代表者</span>
          ) : null}
        </div>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          disabled={busy || isLastOwner}
          title={
            isLastOwner
              ? "最後の代表者は削除できません。先に代表権限を移譲してください。"
              : undefined
          }
          onClick={() => {
            const form = document.createElement("form");
            const fd = new FormData(form);
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
          <Icon name="trash" size={12} aria-hidden /> 削除
        </button>
      </header>

      <input type="hidden" name="x_user_id" value={member.x_user_id} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 8,
        }}
      >
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 8,
        }}
      >
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
      <button className="fn-btn fn-btn-primary fn-btn-sm" disabled={busy}>
        変更を保存
      </button>
    </form>
  );
}

function AddMemberForm({
  eventId,
  isSiteAdmin,
  busy,
  onRun,
}: {
  eventId: string;
  isSiteAdmin: boolean;
  busy: boolean;
  onRun: (action: () => Promise<{ ok: boolean; message?: string }>) => void;
}): React.ReactElement {
  const [preset, setPreset] = React.useState<EventStaffPreset>("manager");
  const [customKeys, setCustomKeys] = React.useState<string[]>([]);
  return (
    <section className="fn-card" style={{ padding: 14 }}>
      <h3 className="fn-console-card-title">メンバーを追加</h3>
      <form
        style={{ display: "grid", gap: 10 }}
        onSubmit={(event) => {
          event.preventDefault();
          const fd = new FormData(event.currentTarget);
          fd.set("event_id", eventId);
          fd.set("permission_preset", preset);
          fd.set("permission_keys", preset === "custom" ? customKeys.join(",") : "");
          onRun(() => upsertEventStaffMember(fd));
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 8,
          }}
        >
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
    <section className="fn-card" style={{ padding: 14, borderColor: "var(--accent-danger)" }}>
      <h3 className="fn-console-card-title">代表権限の移譲</h3>
      <form
        style={{ display: "grid", gap: 8 }}
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
    <section className="fn-card" style={{ padding: 14, display: "grid", gap: 10 }}>
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
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
        gap: 6,
      }}
    >
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
