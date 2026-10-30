import * as React from "react";
import type { ManageStaffMember } from "@flamenode/contracts";
import type { OpsFetch } from "../../api/read.js";
import {
  createManageStaffWriteClient,
  type StaffUpsertInput,
  type StaffTransferInput,
} from "../../api/manageStaffWrite.js";

const PRESETS = [
  ["owner", "代表"], ["manager", "運営"], ["slot_manager", "枠管理担当"],
  ["content_editor", "作品修正担当"], ["reviewer", "レビュー担当"],
  ["public_staff", "表示のみスタッフ"], ["custom", "カスタム"],
  ["xid_reviewer", "X ID確認担当"],
] as const;

function fields(form: HTMLFormElement): StaffUpsertInput {
  const data = new FormData(form);
  const preset = String(data.get("permission_preset") ?? "public_staff");
  return {
    x_user_id: String(data.get("x_user_id") ?? ""),
    display_name: String(data.get("display_name") ?? ""),
    permission_preset: preset,
    permission_keys: preset === "custom" ? String(data.get("permission_keys") ?? "") : "",
    is_public: data.get("is_public") === "1" ? "1" : "0",
    public_role_label: String(data.get("public_role_label") ?? ""),
    reason: String(data.get("reason") ?? ""),
    confirm_text: String(data.get("confirm_text") ?? ""),
  };
}

export interface EventStaffManagerProps {
  eventId: string;
  members: readonly ManageStaffMember[];
  ownerCount: number;
  canManageMembers: boolean;
  isSiteAdmin: boolean;
  fetchFn?: OpsFetch;
  /** Must re-read the Hono-authorized snapshot after a successful write. */
  onRefresh: () => void;
  /** Testable equivalent of CURRENT's window.prompt; null always cancels. */
  promptConfirm?: (message: string, defaultValue: string) => string | null;
}

/**
 * MIG-0723 U01b partial: add/edit/remove and owner-transfer forms only.
 * NO route is mounted until MIG-0654's reviewed server routes and DTOs land.
 * Permission and owner invariants are always authoritative on the server.
 */
export function EventStaffManager({
  eventId, members, ownerCount, canManageMembers, isSiteAdmin,
  fetchFn, onRefresh, promptConfirm,
}: EventStaffManagerProps): React.ReactElement {
  const client = React.useMemo(() => createManageStaffWriteClient(fetchFn), [fetchFn]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const activeIdRef = React.useRef({ eventId, fetchFn, canManageMembers, isSiteAdmin });
  const serialRef = React.useRef(0);
  // Prevent a request from one event/account context updating another event UI
  // during the render before React's passive effect cleanup.
  if (activeIdRef.current.eventId !== eventId || activeIdRef.current.fetchFn !== fetchFn ||
      activeIdRef.current.canManageMembers !== canManageMembers ||
      activeIdRef.current.isSiteAdmin !== isSiteAdmin) {
    activeIdRef.current = { eventId, fetchFn, canManageMembers, isSiteAdmin };
    serialRef.current += 1;
  }
  React.useEffect(() => () => { serialRef.current += 1; }, [eventId, fetchFn, canManageMembers, isSiteAdmin]);

  const run = async (operation: () => Promise<{
    status: "ok" | "anonymous" | "unavailable";
    data?: { ok: boolean; message?: string; pendingPublicReflection?: boolean };
  }>) => {
    if (busy) return;
    const serial = ++serialRef.current;
    const source = activeIdRef.current;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await operation();
      if (serial !== serialRef.current || source !== activeIdRef.current) return;
      if (result.status === "ok" && result.data?.ok) {
        setSuccess(result.data.message ?? "保存しました。");
        setAddOpen(false);
        setExpandedId(null);
        setDeleteId(null);
        onRefresh();
      } else if (result.status === "ok" && result.data?.ok === false) {
        setError(result.data.message ?? "操作に失敗しました。");
      } else {
        setError(result.status === "anonymous" ? "再ログインしてください。" : "操作に失敗しました。");
      }
    } catch {
      if (serial === serialRef.current && source === activeIdRef.current) {
        setError("操作に失敗しました。");
      }
    } finally {
      if (serial === serialRef.current && source === activeIdRef.current) setBusy(false);
    }
  };

  if (!canManageMembers) {
    return <p className="fn-alert manage-readonly-alert">
      この画面は閲覧のみです。メンバーの追加・編集には event.members 権限が必要です。
    </p>;
  }

  const permittedPresets = PRESETS.filter(([key]) => isSiteAdmin || key !== "xid_reviewer");
  const submit = (event: React.FormEvent<HTMLFormElement>, staffId?: string) => {
    event.preventDefault();
    const input = fields(event.currentTarget);
    void run(() => staffId
      ? client.update(eventId, staffId, input)
      : client.create(eventId, input));
  };
  const confirm = promptConfirm ?? ((message: string, fallback: string) =>
    window.prompt(message, fallback));
  const remove = (member: ManageStaffMember) => {
    const confirmText = confirm(
      "自己操作の場合は REMOVE SELF " + eventId + " を入力してください。対象外なら空欄で続行します。",
      "",
    );
    if (confirmText === null) return; // CURRENT T01: cancel must never call the API.
    void run(() => client.remove(eventId, member.id,
      "イベントスタッフ " + (member.x_user_id ?? member.id) + " を削除", confirmText));
  };

  const presetSelect = (defaultValue: string | null, lockOwner = false) =>
    <select className="fn-select" name="permission_preset"
      defaultValue={permittedPresets.some(([k]) => k === defaultValue) ? defaultValue! : "public_staff"}>
      {permittedPresets.map(([value, label]) => <option key={value} value={value} disabled={lockOwner && value !== "owner"}>{label}</option>)}
    </select>;

  return <section aria-label="運営メンバー編集" className="manage-permission-panel">
    {error && <p role="alert" className="fn-alert fn-alert--danger">{error}</p>}
    {success && <p role="status" className="fn-console-note">{success}</p>}
    <header className="manage-staff-list-head">
      <h2>登録メンバー ({members.length} 件表示)</h2>
      <button type="button" className="fn-btn fn-btn-primary fn-btn-sm"
        disabled={busy} onClick={() => {setAddOpen(value => !value); setExpandedId(null);}}>
        運営メンバーを追加
      </button>
    </header>
    {addOpen && <section className="manage-staff-add">
      <h3>メンバーを追加</h3>
      <form className="manage-staff-add-form" onSubmit={event => submit(event)}>
        <input className="fn-input" name="display_name" placeholder="表示名" maxLength={80} required disabled={busy}/>
        <input className="fn-input" name="x_user_id" placeholder="X ID（@なし）" pattern="[A-Za-z0-9_]{1,32}" required disabled={busy}/>
        {presetSelect("manager")}
        <select name="is_public" defaultValue="0" className="fn-select" disabled={busy}>
          <option value="0">非公開</option><option value="1">公開</option>
        </select>
        <input className="fn-input" name="public_role_label" maxLength={40} placeholder="公開肩書" disabled={busy}/>
        <input className="fn-input" name="permission_keys" placeholder="カスタム権限（カンマ区切り）" disabled={busy}/>
        <input className="fn-input" name="reason" placeholder="追加理由" required maxLength={500} disabled={busy}/>
        <button className="fn-btn fn-btn-primary" disabled={busy}>追加</button>
        <button type="button" className="fn-btn fn-btn-ghost" disabled={busy}
          onClick={() => setAddOpen(false)}>閉じる</button>
      </form>
    </section>}
    <ul className="manage-staff-list">
      {members.map(member => {
        const expanded = expandedId === member.id;
        const isLastOwner = member.permission_preset === "owner" && ownerCount <= 1;
        return <li className="manage-staff-list-item" key={member.id}>
          <button type="button" className="manage-staff-list-row" disabled={busy}
            aria-expanded={expanded}
            onClick={() => { setExpandedId(expanded ? null : member.id); setDeleteId(null); }}>
            {member.x_name ?? member.display_name} (@{member.x_user_id ?? "未連携"})
          </button>
          {expanded && <section className="manage-staff-editor">
            <form onSubmit={event => submit(event, member.id)}>
              <input type="hidden" name="x_user_id" value={member.x_user_id ?? ""}/>
              <label className="fn-label">表示名
                <input className="fn-input" name="display_name" defaultValue={member.display_name}
                  maxLength={80} required disabled={busy || member.x_user_id === null}/>
              </label>
              <label className="fn-label">担当プリセット
                {presetSelect(member.permission_preset, isLastOwner)}
              </label>
              <label className="fn-label">公開状態
                <select name="is_public" className="fn-select" defaultValue={String(member.is_public ?? 0)} disabled={busy}>
                  <option value="0">非公開</option><option value="1">公開</option>
                </select>
              </label>
              <label className="fn-label">公開肩書
                <input className="fn-input" name="public_role_label"
                  defaultValue={member.public_role_label ?? ""} maxLength={40} disabled={busy}/>
              </label>
              <label className="fn-label">カスタム権限
                <input className="fn-input" name="permission_keys"
                  defaultValue={member.permission_keys.join(",")} disabled={busy}/>
              </label>
              <label className="fn-label">変更理由
                <input className="fn-input" name="reason" maxLength={500} required disabled={busy}/>
              </label>
              <label className="fn-label">自己操作確認
                <input className="fn-input" name="confirm_text" placeholder={"SELF CHANGE " + eventId} disabled={busy}/>
              </label>
              {isLastOwner && <p role="status">最後の代表者は削除・降格できません。</p>}
              <button className="fn-btn fn-btn-primary fn-btn-sm"
                disabled={busy || member.x_user_id === null}>変更を保存</button>
              <button type="button" className="fn-btn fn-btn-danger fn-btn-sm"
                disabled={busy || isLastOwner}
                onClick={() => setDeleteId(deleteId === member.id ? null : member.id)}>削除</button>
            </form>
            {deleteId === member.id && !isLastOwner && <button type="button"
              className="fn-btn fn-btn-danger fn-btn-sm" disabled={busy}
              onClick={() => remove(member)}>削除を確定</button>}
          </section>}
        </li>;
      })}
    </ul>
    <details className="manage-collapsible manage-staff-advanced">
      <summary>詳細な管理（代表権移譲・CSV）</summary>
      {members.some(m => m.permission_preset === "owner") && members.length > 1 && <form
        className="manage-staff-advanced-form" onSubmit={event => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const input: StaffTransferInput = {
            from_staff_id: String(fields.get("from_staff_id") ?? ""),
            to_staff_id: String(fields.get("to_staff_id") ?? ""),
            reason: String(fields.get("reason") ?? ""),
            confirm_text: String(fields.get("confirm_text") ?? ""),
            self_confirm_text: String(fields.get("self_confirm_text") ?? ""),
          };
          void run(() => client.transferOwnership(eventId, input));
        }}>
        <h3>代表権限の移譲</h3>
        <select className="fn-select" name="from_staff_id" disabled={busy}>
          {members.filter(m => m.permission_preset === "owner").map(m =>
            <option value={m.id} key={m.id}>{m.display_name}</option>)}
        </select>
        <select className="fn-select" name="to_staff_id" disabled={busy}>
          {members.map(m => <option value={m.id} key={m.id}>{m.display_name}</option>)}
        </select>
        <input name="reason" className="fn-input" placeholder="移譲理由" required disabled={busy}/>
        <input name="confirm_text" className="fn-input" placeholder={"TRANSFER " + eventId} required disabled={busy}/>
        <input name="self_confirm_text" className="fn-input" placeholder={"SELF CHANGE " + eventId} disabled={busy}/>
        <button className="fn-btn fn-btn-danger" disabled={busy}>代表権限を移譲</button>
      </form>}
      <p className="fn-console-note">CSVプレビュー・反映は移行中です。現行の管理画面を使用してください。</p>
    </details>
  </section>;
}
