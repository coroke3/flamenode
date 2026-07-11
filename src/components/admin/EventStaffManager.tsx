"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { UserAvatar } from "@/components/user/UserAvatar";
import {
  bulkUpsertEventStaffFromCsv,
  removeEventStaffMember,
  transferEventOwnershipAction,
  upsertEventStaffMember,
} from "@/lib/actions/event-staff-admin";
import { COLLABORATOR_PERMISSION_LABELS } from "@/lib/constants/collaborator-permissions";
import { canonicalizePermissionKey } from "@/lib/auth/permissions/aliases";
import {
  ALL_PERMISSION_KEYS,
  isAdminOnlyKey,
  isDangerousKey,
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
  type EventStaffCsvExistingSubject,
  type EventStaffCsvPreview,
  type EventStaffCsvRow,
} from "@/lib/admin/eventStaffCsv";

export interface EventStaffMemberRow {
  id: string;
  x_user_id: string | null;
  user_id: string | null;
  display_name: string;
  permission_preset: string | null;
  is_public: number | null;
  public_role_label: string | null;
  internal_note: string | null;
  permission_keys: string[];
  x_name: string | null;
  icon_url: string | null;
}

interface EventStaffManagerProps {
  eventId: string;
  members: EventStaffMemberRow[];
  isSiteAdmin: boolean;
  currentUserId: string;
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

const ADMIN_ONLY_PRESETS: readonly EventStaffPreset[] = ["xid_reviewer"];

function visiblePresets(isSiteAdmin: boolean): readonly EventStaffPreset[] {
  return isSiteAdmin ? [...BASE_PRESETS, ...ADMIN_ONLY_PRESETS] : BASE_PRESETS;
}

function normalizeMemberPreset(
  preset: string | null | undefined,
  permissionKeys: readonly string[],
): EventStaffPreset {
  const options = [...BASE_PRESETS, ...ADMIN_ONLY_PRESETS];
  if (preset && (options as readonly string[]).includes(preset)) {
    return preset as EventStaffPreset;
  }
  return permissionKeys.length > 0 ? "custom" : "public_staff";
}

function visibleCustomPermissionKeys(isSiteAdmin: boolean): PermissionKey[] {
  return ALL_PERMISSION_KEYS.filter((key) => isSiteAdmin || !isAdminOnlyKey(key));
}

function capabilityLabels(keys: readonly string[]): string[] {
  return keys.map((key) => {
    const canonical = canonicalizePermissionKey(key);
    if (!canonical) return "不明な権限";
    return COLLABORATOR_PERMISSION_LABELS[canonical]?.label ?? "権限";
  });
}

function resolvePresetKeys(
  preset: EventStaffPreset,
  customKeys: readonly string[],
  isSiteAdmin: boolean,
): PermissionKey[] {
  if (preset === "custom") {
    return customKeys
      .map((key) => canonicalizePermissionKey(key))
      .filter((key): key is PermissionKey => !!key && (isSiteAdmin || !isAdminOnlyKey(key)));
  }
  return [...getPresetPermissions(preset)];
}

function buildPresetDiffMessage(
  currentKeys: readonly string[],
  nextKeys: readonly string[],
): string {
  const current = new Set(
    currentKeys
      .map((k) => canonicalizePermissionKey(k))
      .filter((key): key is PermissionKey => !!key),
  );
  const next = new Set(
    nextKeys
      .map((k) => canonicalizePermissionKey(k))
      .filter((key): key is PermissionKey => !!key),
  );
  const added = [...next].filter((key) => !current.has(key));
  const removed = [...current].filter((key) => !next.has(key));
  const lines: string[] = [];
  if (added.length > 0) {
    lines.push(`追加: ${capabilityLabels(added).join("、")}`);
  }
  if (removed.length > 0) {
    lines.push(`削除: ${capabilityLabels(removed).join("、")}`);
  }
  if (lines.length === 0) {
    return "担当プリセットとできることに変更はありません。";
  }
  return lines.join("\n");
}

export function EventStaffManager({
  eventId,
  members,
  isSiteAdmin,
  currentUserId,
}: EventStaffManagerProps): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<
    (EventStaffMemberRow & { formData: FormData }) | null
  >(null);
  const [savePreview, setSavePreview] = React.useState<{
    fd: FormData;
    message: string;
  } | null>(null);

  const existingCsvSubjects = React.useMemo<EventStaffCsvExistingSubject[]>(
    () =>
      members.map((member) => ({
        x_user_id: member.x_user_id,
        user_id: member.user_id,
      })),
    [members],
  );

  const runUpsert = (fd: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await upsertEventStaffMember(fd);
      if (!result.ok) {
        setError(result.message ?? "更新に失敗しました。");
        return;
      }
      setSavePreview(null);
      router.refresh();
    });
  };

  const requestSave = (
    fd: FormData,
    member: EventStaffMemberRow | null,
    currentKeys: readonly string[],
    nextKeys: readonly string[],
  ) => {
    if (!String(fd.get("reason") ?? "").trim()) {
      setError("変更理由を入力してください。");
      return;
    }
    if (
      member?.user_id === currentUserId &&
      String(fd.get("confirm_text") ?? "").trim() !== `SELF CHANGE ${eventId}`
    ) {
      setError(`自分のスタッフ情報を変更するには「SELF CHANGE ${eventId}」と入力してください。`);
      return;
    }
    setSavePreview({
      fd,
      message: buildPresetDiffMessage(currentKeys, nextKeys),
    });
  };

  const requestRemove = (member: EventStaffMemberRow, formData: FormData) => {
    if (!String(formData.get("reason") ?? "").trim()) {
      setError("削除理由を入力してください。");
      return;
    }
    if (
      member.user_id === currentUserId &&
      String(formData.get("confirm_text") ?? "").trim() !== `REMOVE SELF ${eventId}`
    ) {
      setError(`自分をスタッフから削除するには「REMOVE SELF ${eventId}」と入力してください。`);
      return;
    }
    setError(null);
    setRemoveTarget({ ...member, formData });
  };

  const runRemove = () => {
    if (!removeTarget) return;
    const { formData, ...target } = removeTarget;
    setRemoveTarget(null);
    formData.set("event_id", eventId);
    formData.set("staff_id", target.id);
    setError(null);
    startTransition(async () => {
      const result = await removeEventStaffMember(formData);
      if (!result.ok) {
        setError(result.message ?? "削除に失敗しました。");
        return;
      }
      router.refresh();
    });
  };

  const runOwnershipTransfer = (fd: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await transferEventOwnershipAction(fd);
      if (!result.ok) {
        setError(result.message ?? "代表権限の移譲に失敗しました。");
        return;
      }
      router.refresh();
    });
  };

  const ownerCount = members.filter((member) => member.permission_preset === "owner").length;

  const runCsvImport = (rows: EventStaffCsvRow[], reason: string) => {
    const validRows = rows.filter((row) => row.errors.length === 0);
    if (validRows.length === 0) {
      setError("取り込める行がありません。");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await bulkUpsertEventStaffFromCsv({
        eventId,
        rows: validRows,
        reason,
      });
      if (!result.ok) {
        setError(result.message ?? "CSVの取り込みに失敗しました。");
        return;
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
          title={`メンバー管理 (${members.length})`}
          description="表示名、公開設定、担当プリセットを1画面で管理します。custom のときだけ詳細権限を選べます。"
        />
        {members.length === 0 ? (
          <EmptyState label="運営メンバーはまだ登録されていません。" />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {members.map((member) => (
              <MemberCard
                key={member.id}
                eventId={eventId}
                member={member}
                isSiteAdmin={isSiteAdmin}
                currentUserId={currentUserId}
                ownerCount={ownerCount}
                busy={busy}
                onRequestSave={requestSave}
                onRemove={requestRemove}
              />
            ))}
          </div>
        )}
        <AddMemberForm
          eventId={eventId}
          isSiteAdmin={isSiteAdmin}
          busy={busy}
          onRequestSave={(fd, nextKeys) => requestSave(fd, null, [], nextKeys)}
        />
      </section>

      <OwnershipTransferForm
        eventId={eventId}
        members={members}
        currentUserId={currentUserId}
        busy={busy}
        onTransfer={runOwnershipTransfer}
      />

      <CsvImportSection
        isSiteAdmin={isSiteAdmin}
        existingSubjects={existingCsvSubjects}
        busy={busy}
        onImport={runCsvImport}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title="メンバーを削除しますか?"
        message={`${removeTarget?.display_name ?? "このメンバー"} をイベント運営メンバーから外します。`}
        confirmLabel="削除する"
        tone="danger"
        onConfirm={runRemove}
        onCancel={() => setRemoveTarget(null)}
      />

      <ConfirmDialog
        open={savePreview !== null}
        title="担当プリセットの変更を保存しますか?"
        message={savePreview?.message ?? ""}
        confirmLabel="保存する"
        onConfirm={() => {
          if (savePreview) runUpsert(savePreview.fd);
        }}
        onCancel={() => setSavePreview(null)}
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

function MemberCard({
  eventId,
  member,
  isSiteAdmin,
  currentUserId,
  ownerCount,
  busy,
  onRequestSave,
  onRemove,
}: {
  eventId: string;
  member: EventStaffMemberRow;
  isSiteAdmin: boolean;
  currentUserId: string;
  ownerCount: number;
  busy: boolean;
  onRequestSave: (
    fd: FormData,
    member: EventStaffMemberRow,
    currentKeys: readonly string[],
    nextKeys: readonly string[],
  ) => void;
  onRemove: (member: EventStaffMemberRow, formData: FormData) => void;
}): React.ReactElement {
  const [preset, setPreset] = React.useState<EventStaffPreset>(() =>
    normalizeMemberPreset(member.permission_preset, member.permission_keys),
  );
  const [customKeys, setCustomKeys] = React.useState<string[]>(
    () => member.permission_keys,
  );
  const presetOptions = visiblePresets(isSiteAdmin);
  const customPermissionKeys = visibleCustomPermissionKeys(isSiteAdmin);
  const capabilityKeys = resolvePresetKeys(preset, customKeys, isSiteAdmin);
  const isOwner = member.permission_preset === "owner";
  const isLastOwner = isOwner && ownerCount === 1;
  const isCurrentUser = member.user_id === currentUserId;

  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.currentTarget);
        fd.set("event_id", eventId);
        fd.set("staff_id", member.id);
        fd.set("permission_preset", preset);
        fd.set(
          "permission_keys",
          preset === "custom" ? fd.getAll("permission_key").map(String).join(",") : "",
        );
        const nextKeys = resolvePresetKeys(
          preset,
          preset === "custom" ? fd.getAll("permission_key").map(String) : [],
          isSiteAdmin,
        );
        onRequestSave(fd, member, member.permission_keys, nextKeys);
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
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 10, minWidth: 0 }}>
          <MemberAvatar iconUrl={member.icon_url} name={member.display_name} />
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: "block", overflowWrap: "anywhere" }}>{member.display_name}</strong>
            {isOwner ? <span className="fn-badge fn-badge-warning">代表者</span> : null}
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              {member.x_user_id ? `@${member.x_user_id}` : ""}
              {member.user_id
                ? `${member.x_user_id ? " / " : ""}user:${member.user_id}`
                : ""}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          disabled={busy || isLastOwner}
          title={isLastOwner ? "最後の代表者は削除できません。先に代表権限を移譲してください。" : undefined}
          onClick={(event) => {
            const form = event.currentTarget.form;
            if (form) onRemove(member, new FormData(form));
          }}
          aria-label={`${member.display_name} を削除`}
        >
          <Icon name="trash" size={11} aria-hidden />
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))",
          gap: 8,
        }}
      >
        <input type="hidden" name="display_name" value={member.display_name} />
        <input type="hidden" name="x_user_id" value={member.x_user_id ?? ""} />
        <input type="hidden" name="user_id" value={member.user_id ?? ""} />
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
          公開ラベル
          <input
            type="text"
            name="public_role_label"
            defaultValue={member.public_role_label ?? ""}
            placeholder="例: 進行"
            className="fn-input"
            maxLength={40}
            disabled={busy}
          />
        </label>
        <label className="fn-label">
          表示分類
          <input
            type="text"
            name="internal_note"
            defaultValue={member.internal_note ?? ""}
            placeholder="内部メモ"
            className="fn-input"
            maxLength={120}
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
            {presetOptions.map((option) => (
              <option key={option} value={option} disabled={isLastOwner && option !== "owner"}>
                {PRESET_DEFINITIONS[option].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isLastOwner ? (
        <p className="fn-alert fn-alert--danger" style={{ margin: 0 }}>
          このイベントの最後の代表者です。削除または権限を下げる前に、別のスタッフへ代表権限を移譲してください。
        </p>
      ) : null}

      <div>
        <div className="fn-console-eyebrow" style={{ marginBottom: 6 }}>できること</div>
        <p className="fn-console-note" style={{ margin: "0 0 8px" }}>
          {PRESET_DEFINITIONS[preset].description}
        </p>
        {preset === "custom" ? (
          <PermissionChecklist
            keys={customPermissionKeys}
            selected={new Set(customKeys)}
            busy={busy}
            onToggle={(key, checked) => {
              setCustomKeys((prev) =>
                checked ? [...new Set([...prev, key])] : prev.filter((item) => item !== key),
              );
            }}
          />
        ) : (
          <CapabilityBadges keys={capabilityKeys} />
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
          gap: 8,
        }}
      >
        <label className="fn-label">
          変更・削除の理由 (必須)
          <input
            type="text"
            name="reason"
            className="fn-input"
            placeholder="監査ログに残す理由"
            maxLength={500}
            required
            disabled={busy}
          />
        </label>
        <label className="fn-label">
          自己操作の確認
          <input
            type="text"
            name="confirm_text"
            className="fn-input"
            placeholder={isCurrentUser ? `SELF CHANGE ${eventId} / REMOVE SELF ${eventId}` : `SELF CHANGE ${eventId}`}
            disabled={busy}
          />
          <span className="fn-console-note">
            自分の変更時は SELF CHANGE、自己削除時は REMOVE SELF をイベント ID 付きで入力します。
          </span>
        </label>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm" disabled={busy}>
          変更を確認
        </button>
      </div>
    </form>
  );
}

function AddMemberForm({
  eventId,
  isSiteAdmin,
  busy,
  onRequestSave,
}: {
  eventId: string;
  isSiteAdmin: boolean;
  busy: boolean;
  onRequestSave: (fd: FormData, nextKeys: readonly string[]) => void;
}): React.ReactElement {
  const [preset, setPreset] = React.useState<EventStaffPreset>("manager");
  const [customKeys, setCustomKeys] = React.useState<string[]>([]);
  const presetOptions = visiblePresets(isSiteAdmin);
  const customPermissionKeys = visibleCustomPermissionKeys(isSiteAdmin);

  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.currentTarget);
        fd.set("event_id", eventId);
        fd.set("permission_preset", preset);
        fd.set(
          "permission_keys",
          preset === "custom" ? customKeys.join(",") : "",
        );
        const nextKeys = resolvePresetKeys(preset, customKeys, isSiteAdmin);
        onRequestSave(fd, nextKeys);
        ev.currentTarget.reset();
        setPreset("manager");
        setCustomKeys([]);
      }}
      style={{
        display: "grid",
        gap: 12,
        padding: 12,
        border: "1px dashed var(--border-subtle)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <h4 style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>メンバーを追加</h4>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
          gap: 8,
        }}
      >
        <input type="text" name="display_name" placeholder="表示名" className="fn-input" required disabled={busy} />
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
          name="user_id"
          placeholder="ユーザー ID"
          className="fn-input"
          disabled={busy}
        />
        <select
          value={preset}
          onChange={(event) => setPreset(event.target.value as EventStaffPreset)}
          className="fn-select"
          disabled={busy}
        >
          {presetOptions.map((option) => (
            <option key={option} value={option}>
              {PRESET_DEFINITIONS[option].label}
            </option>
          ))}
        </select>
        <select name="is_public" defaultValue="0" className="fn-select" disabled={busy}>
          <option value="0">非公開</option>
          <option value="1">公開</option>
        </select>
        <input
          type="text"
          name="public_role_label"
          placeholder="公開ラベル"
          className="fn-input"
          maxLength={40}
          disabled={busy}
        />
        <input
          type="text"
          name="internal_note"
          placeholder="表示分類（内部メモ）"
          className="fn-input"
          maxLength={120}
          disabled={busy}
        />
      </div>

      <p className="fn-console-note" style={{ margin: 0 }}>
        {PRESET_DEFINITIONS[preset].description}
      </p>

      {preset === "custom" ? (
        <PermissionChecklist
          keys={customPermissionKeys}
          selected={new Set(customKeys)}
          busy={busy}
          onToggle={(key, checked) => {
            setCustomKeys((prev) =>
              checked ? [...new Set([...prev, key])] : prev.filter((item) => item !== key),
            );
          }}
        />
      ) : (
        <CapabilityBadges keys={resolvePresetKeys(preset, [], isSiteAdmin)} />
      )}

      <label className="fn-label">
        追加理由 (必須)
        <input
          type="text"
          name="reason"
          className="fn-input"
          placeholder="監査ログに残す理由"
          maxLength={500}
          required
          disabled={busy}
        />
      </label>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm" disabled={busy}>
          <Icon name="plus" size={11} aria-hidden /> 追加を確認
        </button>
      </div>
    </form>
  );
}

function OwnershipTransferForm({
  eventId,
  members,
  currentUserId,
  busy,
  onTransfer,
}: {
  eventId: string;
  members: readonly EventStaffMemberRow[];
  currentUserId: string;
  busy: boolean;
  onTransfer: (fd: FormData) => void;
}): React.ReactElement | null {
  const ownerMembers = members.filter((member) => member.permission_preset === "owner");
  const [fromStaffId, setFromStaffId] = React.useState(ownerMembers[0]?.id ?? "");
  const [toStaffId, setToStaffId] = React.useState(
    members.find((member) => member.id !== ownerMembers[0]?.id)?.id ?? "",
  );
  const fromMember = ownerMembers.find((member) => member.id === fromStaffId) ?? ownerMembers[0];
  const targetMembers = members.filter((member) => member.id !== fromMember?.id);
  const needsSelfConfirmation = fromMember?.user_id === currentUserId;

  if (!fromMember || targetMembers.length === 0) return null;

  return (
    <section
      style={{
        display: "grid",
        gap: 10,
        padding: 14,
        border: "1px solid var(--danger-border, #c62828)",
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-base)",
      }}
    >
      <div>
        <h3 className="fn-console-card-title" style={{ marginBottom: 4 }}>代表権限の移譲</h3>
        <p className="fn-console-note">
          最後の代表者を削除・降格する前に、登録済みスタッフへ代表権限を移譲してください。
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const fd = new FormData(event.currentTarget);
          fd.set("event_id", eventId);
          fd.set("from_staff_id", fromMember.id);
          fd.set("to_staff_id", toStaffId);
          onTransfer(fd);
        }}
        style={{ display: "grid", gap: 8 }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
            gap: 8,
          }}
        >
          <label className="fn-label">
            移譲元（代表者）
            <select
              value={fromMember.id}
              className="fn-select"
              disabled={busy}
              onChange={(event) => {
                const nextFromId = event.target.value;
                setFromStaffId(nextFromId);
                if (toStaffId === nextFromId) {
                  setToStaffId(members.find((member) => member.id !== nextFromId)?.id ?? "");
                }
              }}
            >
              {ownerMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.display_name} ({member.x_user_id ? `@${member.x_user_id}` : `user:${member.user_id ?? member.id}`})
                </option>
              ))}
            </select>
          </label>
          <label className="fn-label">
            移譲先
            <select
              value={toStaffId}
              className="fn-select"
              disabled={busy}
              onChange={(event) => setToStaffId(event.target.value)}
            >
              {targetMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.display_name} ({member.x_user_id ? `@${member.x_user_id}` : `user:${member.user_id ?? member.id}`})
                </option>
              ))}
            </select>
          </label>
          <label className="fn-label">
            移譲理由 (必須)
            <input type="text" name="reason" className="fn-input" maxLength={500} required disabled={busy} />
          </label>
          <label className="fn-label">
            移譲確認 (必須)
            <input
              type="text"
              name="confirm_text"
              className="fn-input"
              placeholder={`TRANSFER ${eventId}`}
              required
              disabled={busy}
            />
          </label>
          <label className="fn-label">
            自己変更の確認{needsSelfConfirmation ? " (必須)" : ""}
            <input
              type="text"
              name="self_confirm_text"
              className="fn-input"
              placeholder={`SELF CHANGE ${eventId}`}
              required={needsSelfConfirmation}
              disabled={busy}
            />
          </label>
        </div>
        <p className="fn-console-note" style={{ margin: 0 }}>
          確認欄には「TRANSFER {eventId}」を正確に入力してください。移譲元が自分の場合は「SELF CHANGE {eventId}」も必要です。
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="submit" className="fn-btn fn-btn-danger fn-btn-sm" disabled={busy}>
            代表権限を移譲する
          </button>
        </div>
      </form>
    </section>
  );
}

function CapabilityBadges({ keys }: { keys: readonly PermissionKey[] }): React.ReactElement {
  if (keys.length === 0) {
    return <span className="fn-muted fn-text-sm">内部編集権限は付与されません。</span>;
  }
  return (
    <div className="fn-console-badge-row">
      {keys.map((key) => {
        const meta = COLLABORATOR_PERMISSION_LABELS[key];
        return (
          <span key={key} className="fn-badge fn-badge-soft" title={meta?.description ?? ""}>
            {meta?.label ?? "権限"}
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
  onToggle,
}: {
  keys: readonly PermissionKey[];
  selected: ReadonlySet<string>;
  busy: boolean;
  onToggle: (key: PermissionKey, checked: boolean) => void;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 220px), 1fr))",
        gap: 8,
      }}
    >
      {keys.map((key) => {
        const meta = COLLABORATOR_PERMISSION_LABELS[key];
        const checked = selected.has(key);
        const dangerous = isDangerousKey(key) || isAdminOnlyKey(key);
        return (
          <label
            key={key}
            title={meta?.description ?? ""}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              padding: "9px 10px",
              border: dangerous
                ? "1px solid var(--danger-border, #c62828)"
                : "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              background: checked ? "var(--accent-primary-soft)" : "var(--bg-base)",
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            <input
              type="checkbox"
              name="permission_key"
              value={key}
              checked={checked}
              onChange={(event) => onToggle(key, event.target.checked)}
              disabled={busy}
              style={{ marginTop: 2 }}
            />
            <span style={{ minWidth: 0 }}>
              <strong style={{ display: "block", fontSize: 12 }}>{meta?.label ?? "権限"}</strong>
              <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.45 }}>
                {meta?.description ?? ""}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function CsvImportSection({
  isSiteAdmin,
  existingSubjects,
  busy,
  onImport,
}: {
  isSiteAdmin: boolean;
  existingSubjects: readonly EventStaffCsvExistingSubject[];
  busy: boolean;
  onImport: (rows: EventStaffCsvRow[], reason: string) => void;
}): React.ReactElement {
  const [csvText, setCsvText] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [csvPreview, setCsvPreview] = React.useState<EventStaffCsvPreview | null>(null);
  const [copied, setCopied] = React.useState(false);
  const previewValidRows = csvPreview?.rows.filter((row) => row.errors.length === 0) ?? [];

  const copyCsvPrompt = async () => {
    const prompt = [
      "次の情報を FlameNode のイベント運営メンバーCSVに整形してください。",
      "出力はCSV本文のみ。列は 表示名,X ID,ユーザー ID,担当プリセット,公開フラグ,公開ラベル の6列です。",
      "ユーザー ID はAuth.js内部ユーザーIDであり、Discord Snowflakeは入力しません。",
      "担当プリセットは manager,slot_manager,content_editor,reviewer,public_staff のいずれかを使ってください。代表者の変更はCSVでは行えません。",
      "X IDは@なし。公開する場合は1、それ以外は0にしてください。",
    ].join("\n");
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <section style={{ display: "grid", gap: 8 }}>
      <label className="fn-label" htmlFor="staff_csv">
        CSVでまとめて追加
      </label>
      <textarea
        id="staff_csv"
        className="fn-input"
        rows={5}
        value={csvText}
        onChange={(event) => {
          setCsvText(event.target.value);
          setCsvPreview(null);
        }}
        placeholder={EVENT_STAFF_CSV_SAMPLE}
        disabled={busy}
      />
      <label className="fn-label" htmlFor="staff_csv_reason">
        変更理由
      </label>
      <input
        id="staff_csv_reason"
        className="fn-input"
        type="text"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="例: 企画運営チームの一括登録"
        maxLength={500}
        required
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
            setCsvPreview(
              buildEventStaffCsvPreview({
                text: csvText,
                existingSubjects,
                isSiteAdmin,
              }),
            );
          }}
          disabled={busy || csvText.trim().length === 0}
        >
          <Icon name="info" size={11} aria-hidden /> CSVをプレビュー
        </button>
        <button
          type="button"
          className="fn-btn fn-btn-primary fn-btn-sm"
          onClick={() => {
            if (!csvPreview || csvPreview.hasErrors) return;
            onImport(previewValidRows, reason);
          }}
          disabled={busy || !csvPreview || csvPreview.hasErrors || previewValidRows.length === 0 || reason.trim().length === 0}
        >
          <Icon name="upload" size={11} aria-hidden /> プレビュー内容を保存
        </button>
      </div>
      {csvPreview ? <CsvPreviewPanel preview={csvPreview} /> : null}
    </section>
  );
}

function CsvPreviewPanel({
  preview,
}: {
  preview: EventStaffCsvPreview;
}): React.ReactElement {
  if (preview.rows.length === 0) {
    return (
      <p className="fn-alert fn-alert--danger" style={{ margin: 0 }}>
        <Icon name="warning" size={13} aria-hidden /> 取り込める行がありません。
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="fn-console-badge-row">
        <span className="fn-badge fn-badge-soft">追加 {preview.counts.create}件</span>
        <span className="fn-badge fn-badge-soft">更新 {preview.counts.update}件</span>
        <span className={preview.counts.error > 0 ? "fn-badge fn-badge-warning" : "fn-badge fn-badge-neutral"}>
          エラー {preview.counts.error}件
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="fn-table" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th style={{ width: 54 }}>行</th>
              <th style={{ width: 82 }}>判定</th>
              <th>表示名</th>
              <th>対象</th>
              <th style={{ width: 150 }}>担当</th>
              <th style={{ width: 120 }}>公開表示</th>
              <th>結果</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={`${row.lineNumber}-${row.display_name}`}>
                <td>{row.lineNumber}</td>
                <td>
                  <span className={row.action === "update" ? "fn-badge fn-badge-warning" : "fn-badge fn-badge-soft"}>
                    {row.action === "update" ? "更新" : "追加"}
                  </span>
                </td>
                <td>{row.display_name}</td>
                <td>
                  {row.x_user_id ? <code>@{row.x_user_id}</code> : row.user_id ? <code>user:{row.user_id}</code> : "-"}
                </td>
                <td>{eventStaffCsvPresetLabel(row.permission_preset)}</td>
                <td>
                  {row.is_public_staff === "1" ? "公開" : "非公開"}
                  {row.public_role_label ? ` / ${row.public_role_label}` : ""}
                </td>
                <td>
                  {row.errors.length > 0 ? (
                    <span className="fn-alert fn-alert--danger" style={{ margin: 0 }}>
                      {row.errors.join(" / ")}
                    </span>
                  ) : (
                    <span className="fn-muted fn-text-sm">
                      {row.warnings.length > 0 ? row.warnings.join(" / ") : "OK"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
