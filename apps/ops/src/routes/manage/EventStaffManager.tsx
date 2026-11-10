import * as React from "react";
import type { ManageStaffMember } from "@flamenode/contracts";
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_DEFINITIONS,
  canonicalizePermissionKey,
  isAdminOnlyKey,
  type PermissionCategory,
  type PermissionKey,
} from "@flamenode/domain/auth/permissions";
import {
  getPresetPermissions,
  PRESET_DEFINITIONS,
  isEventStaffPreset,
  type EventStaffPreset,
} from "@flamenode/domain/auth/permissions/presets";
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

const CSV_SAMPLE = [
  "表示名,X ID,担当プリセット,公開フラグ,公開ラベル",
  "進行担当,yamada,枠管理担当,1,進行",
  "審査担当,sato,レビュー担当,0,",
  "作品修正担当,tanaka,作品修正担当,0,",
  "限定担当,suzuki,カスタム:枠管理|作品基本情報,0,",
].join("\n");

type StaffCsvRow = {
  lineNumber: number;
  display_name: string;
  x_user_id: string;
  permission_preset: EventStaffPreset;
  permission_keys: PermissionKey[];
  is_public_staff: "0" | "1";
  public_role_label: string;
  action: "create" | "update";
  errors: string[];
  warnings: string[];
};

function parseStaffCsvText(input: string): { rows: string[][]; malformed: boolean } {
  const text = input.replace(/^\uFEFF/, "");
  const firstRecord = text.split(/[\r\n]/, 1)[0] ?? "";
  let quoted = false, commas = 0, tabs = 0;
  for (let i = 0; i < firstRecord.length; i += 1) {
    if (firstRecord[i] === '"') {
      if (quoted && firstRecord[i + 1] === '"') i += 1;
      else quoted = !quoted;
    } else if (!quoted && firstRecord[i] === ",") commas += 1;
    else if (!quoted && firstRecord[i] === "\t") tabs += 1;
  }
  const delimiter = tabs > commas ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\r") continue;
    else if (ch === "\n") {
      row.push(field);
      if (row.some(cell => cell.trim())) rows.push(row);
      row = []; field = "";
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some(cell => cell.trim())) rows.push(row);
  }
  return { rows, malformed: inQuotes };
}

function buildStaffCsvPreview(text: string, members: readonly ManageStaffMember[], isSiteAdmin: boolean) {
  const existing = new Set(members.map(member => member.x_user_id?.replace(/^@+/, "").trim().toLowerCase()).filter((value): value is string => !!value));
  const parsedCsv = parseStaffCsvText(text);
  const parsed = parsedCsv.rows.map(row => row.map(cell => cell.trim()));
  const rows: StaffCsvRow[] = [];
  const seenXIds = new Set<string>();
  parsed.forEach((cols, index) => {
    const first = cols[0]?.toLowerCase() ?? "";
    const second = cols[1]?.toLowerCase() ?? "";
    if (index === 0 && ["表示名", "display_name", "name"].includes(first) &&
        ["x id", "x_id", "x user id"].includes(second)) return;
    const [rawName = "", rawXId = "", rawAssignment = "", rawPublic = "0", rawLabel = ""] = cols;
    const xUserId = rawXId.replace(/^@+/, "").trim().toLowerCase();
    const errors: string[] = [];
    if (seenXIds.has(xUserId)) errors.push("同じCSV内にX IDが重複しています。");
    seenXIds.add(xUserId);
    let preset: EventStaffPreset = "public_staff";
    let permissionKeys: PermissionKey[] = [];
    const assignment = rawAssignment.trim();
    if (isEventStaffPreset(assignment)) preset = assignment;
    else {
      const labelMatch = (Object.entries(PRESET_DEFINITIONS) as [EventStaffPreset, typeof PRESET_DEFINITIONS[EventStaffPreset]][])
        .find(([, definition]) => definition.label === assignment);
      if (labelMatch) preset = labelMatch[0];
      else {
        const custom = assignment.replace(/^(custom:|カスタム[:：])/, "");
        for (const rawKey of custom.split(/[|;]/)) {
          if (!rawKey.trim()) continue;
          const value = rawKey.trim();
          const key = canonicalizePermissionKey(value) ??
            ALL_PERMISSION_KEYS.find(candidate => PERMISSION_DEFINITIONS[candidate].label === value) ?? null;
          if (!key) errors.push(`選べない権限「${value}」が含まれています。`);
          else if (!permissionKeys.includes(key)) permissionKeys.push(key);
        }
        preset = permissionKeys.length ? "custom" : "public_staff";
      }
    }
    if (cols.length !== 5) errors.push("正本CSVは「表示名,X ID,担当プリセット,公開フラグ,公開ラベル」の5列です。");
    if (!rawName.trim() || rawName.trim().length > 80) errors.push("表示名は1〜80文字で入力してください。");
    if (rawLabel.trim().length > 40) errors.push("公開ラベルは40文字以内で入力してください。");
    if (rawPublic !== "0" && rawPublic !== "1") errors.push("公開フラグは0または1を指定してください。");
    if (!/^[a-z0-9_]{1,32}$/.test(xUserId)) errors.push("X ID の形式が正しくありません。");
    if (preset === "owner") errors.push("代表者の追加・変更はCSVでは行えません。専用の代表者移譲操作を使用してください。");
    if (preset === "xid_reviewer" && !isSiteAdmin) errors.push("X ID確認担当プリセットは site admin だけが付与できます。");
    if (!isSiteAdmin && permissionKeys.some(isAdminOnlyKey)) errors.push("site admin 専用権限はイベント運営者から付与できません。");
    rows.push({
      lineNumber: index + 1,
      display_name: rawName.trim() || `運営メンバー ${index + 1}`,
      x_user_id: xUserId,
      permission_preset: preset,
      permission_keys: permissionKeys,
      is_public_staff: rawPublic === "1" ? "1" : "0",
      public_role_label: rawLabel.trim(),
      action: existing.has(xUserId) ? "update" : "create",
      errors: [...new Set(errors)],
      warnings: [],
    });
  });
  const counts = rows.reduce((acc, row) => {
    if (row.errors.length) acc.error += 1;
    else acc[row.action] += 1;
    return acc;
  }, { create: 0, update: 0, error: 0 });
  const overLimit = rows.length > 100;
  return { rows, counts, malformed: parsedCsv.malformed, overLimit,
    hasErrors: counts.error > 0 || overLimit || parsedCsv.malformed };
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
function StaffCsvImport({
  members, isSiteAdmin, busy, onImport,
}: {
  members: readonly ManageStaffMember[];
  isSiteAdmin: boolean;
  busy: boolean;
  onImport: (reason: string, rows: StaffCsvRow[]) => void;
}): React.ReactElement {
  const [text, setText] = React.useState(CSV_SAMPLE);
  const [reason, setReason] = React.useState("スタッフCSV反映");
  const preview = React.useMemo(
    () => buildStaffCsvPreview(text, members, isSiteAdmin),
    [text, members, isSiteAdmin],
  );
  return <section className="manage-staff-advanced-section">
    <h3>スタッフCSV</h3>
    <label className="fn-label">CSV（5列：表示名、X ID、担当プリセット、公開フラグ、公開ラベル）
      <textarea className="fn-input" rows={7} value={text}
        onInput={event => setText(event.currentTarget.value)} disabled={busy}/>
    </label>
    <p className="fn-console-note" role="status">
      新規 {preview.counts.create} / 更新 {preview.counts.update} / エラー {preview.counts.error}
    </p>
    <div className="manage-staff-csv-preview">
      {preview.malformed && <p role="alert">CSVの引用符が閉じられていません。</p>}
      {preview.overLimit && <p role="alert">CSVは100件以内にしてください。</p>}
      {preview.rows.slice(0, 10).map(row => <p key={row.lineNumber} className="fn-console-note">
        {row.lineNumber}行: {row.display_name} / @{row.x_user_id} / {PRESET_DEFINITIONS[row.permission_preset].label}
        {row.errors.length ? " / " + row.errors.join("、") : ""}
      </p>)}
      {preview.rows.length > 10 && <p className="fn-console-note">先頭10行を表示しています（全{preview.rows.length}行）。</p>}
      {preview.rows.length === 0 && <p className="fn-console-note">取り込む行がありません。</p>}
    </div>
    <label className="fn-label">反映理由
      <input className="fn-input" value={reason} maxLength={500}
        onChange={event => setReason(event.target.value)} disabled={busy}/>
    </label>
    <button type="button" className="fn-btn fn-btn-primary"
      disabled={busy || preview.rows.length === 0 || preview.hasErrors || !reason.trim()}
      onClick={() => onImport(reason, preview.rows)}>
      CSVを反映
    </button>
  </section>;
}

const PermissionAssignment = ({
initialPreset,
initialKeys,
isSiteAdmin,
busy,
lockOwner = false,
}: {
initialPreset: string | null;
initialKeys: readonly string[];
isSiteAdmin: boolean;
busy: boolean;
lockOwner?: boolean;
}): React.ReactElement => {
const availablePresets = PRESETS.filter(([key]) => isSiteAdmin || key !== "xid_reviewer");
const initial = availablePresets.some(([key]) => key === initialPreset)
  ? initialPreset as EventStaffPreset
  : "public_staff";
const [preset, setPreset] = React.useState<EventStaffPreset>(initial);
const [selected, setSelected] = React.useState<PermissionKey[]>(
  () => initialKeys.filter((key): key is PermissionKey => ALL_PERMISSION_KEYS.includes(key as PermissionKey)),
);
return <section className="manage-staff-permission-assignment">
  <label className="fn-label">担当プリセット
    <select className="fn-select" value={preset} disabled={busy}
      onChange={event => setPreset(event.target.value as EventStaffPreset)}>
      {availablePresets.map(([value, label]) =>
        <option key={value} value={value} disabled={lockOwner && value !== "owner"}>{label}</option>)}
    </select>
  </label>
  <input type="hidden" name="permission_preset" value={preset}/>
  <input type="hidden" name="permission_keys" value={preset === "custom" ? selected.join(",") : ""}/>
  {preset === "custom" ? <PermissionChecklist
    isSiteAdmin={isSiteAdmin} selected={selected} onChange={setSelected} disabled={busy}
  /> : <PresetPermissionSummary preset={preset} isSiteAdmin={isSiteAdmin}/>}
</section>;
};

const PERMISSION_CATEGORY_LABELS: Record<PermissionCategory, string> = {
event: "イベント",
video: "作品",
xid: "X ID",
danger: "高度・危険な操作",
};

function PresetPermissionSummary({preset, isSiteAdmin}: {
preset: EventStaffPreset; isSiteAdmin: boolean;
}): React.ReactElement {
const keys = getPresetPermissions(preset).filter(key => isSiteAdmin || !isAdminOnlyKey(key));
return <div className="fn-console-note">
  <p>{PRESET_DEFINITIONS[preset].description}</p>
  {keys.length ? <div className="manage-staff-permission-summary">
    {keys.map(key => {
      const definition = PERMISSION_DEFINITIONS[key];
      return <span key={key} className={definition.dangerous ? "fn-badge fn-badge-warning" : "fn-badge fn-badge-soft"}
        title={definition.description}>{definition.label}</span>;
    })}
  </div> : <span className="fn-muted">内部操作権限はありません。</span>}
</div>;
}

function PermissionChecklist({isSiteAdmin, selected, onChange, disabled}: {
isSiteAdmin: boolean; selected: PermissionKey[];
onChange: (keys: PermissionKey[]) => void; disabled: boolean;
}): React.ReactElement {
const selectedSet = new Set(selected);
const visibleKeys = ALL_PERMISSION_KEYS.filter(key => isSiteAdmin || !isAdminOnlyKey(key));
const categories: PermissionCategory[] = ["event", "video", "xid", "danger"];
return <div className="manage-permission-checklist">
  {categories.map(category => {
    const keys = visibleKeys.filter(key => PERMISSION_DEFINITIONS[key].category === category);
    if (!keys.length) return null;
    return <fieldset key={category} className="manage-permission-category">
      <legend>{PERMISSION_CATEGORY_LABELS[category]}</legend>
      {keys.map(key => {
        const definition = PERMISSION_DEFINITIONS[key];
        return <label key={key} className="fn-label manage-permission-option">
          <input type="checkbox" value={key} checked={selectedSet.has(key)} disabled={disabled}
            onChange={event => onChange(event.target.checked
              ? [...selectedSet, key]
              : selected.filter(value => value !== key))}/>
          <span>{definition.label}{definition.dangerous ? "（重要）" : ""}</span>
          <small>{definition.description}</small>
        </label>;
      })}
    </fieldset>;
  })}
</div>;
}

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
  const contextEpochRef = React.useRef(0);
  const serialRef = React.useRef(0);
  // A state update is not synchronous: two submits in one event batch must not
  // start two privileged writes before React renders the disabled controls.
  const inFlightRef = React.useRef<number | null>(null);
  // Prevent a request from one event/account context updating another event UI
  // during the render before React's passive effect cleanup.
  if (activeIdRef.current.eventId !== eventId || activeIdRef.current.fetchFn !== fetchFn ||
      activeIdRef.current.canManageMembers !== canManageMembers ||
      activeIdRef.current.isSiteAdmin !== isSiteAdmin) {
    activeIdRef.current = { eventId, fetchFn, canManageMembers, isSiteAdmin };
    contextEpochRef.current += 1; // Remount the CSV editor: never carry another event/account input across contexts.
    serialRef.current += 1;
    inFlightRef.current = null; // A new event/identity is a separate write context.
  }
  React.useEffect(() => {
    // A settled request from event A must not leave event B disabled, or leak
    // A's success/error and open editor state into the new authorization context.
    setBusy(false);
    setError(null);
    setSuccess(null);
    setAddOpen(false);
    setExpandedId(null);
    setDeleteId(null);
    return () => { serialRef.current += 1; };
  }, [eventId, fetchFn, canManageMembers, isSiteAdmin]);

  const run = async (operation: () => Promise<{
    status: "ok" | "anonymous" | "unavailable";
    data?: { ok: boolean; message?: string; pendingPublicReflection?: boolean };
  }>) => {
    if (inFlightRef.current !== null) return;
    const serial = ++serialRef.current;
    inFlightRef.current = serial;
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
      // A stale request must never release a newer request's in-flight guard.
      if (inFlightRef.current === serial) inFlightRef.current = null;
      if (serial === serialRef.current && source === activeIdRef.current) setBusy(false);
    }
  };

  if (!canManageMembers) {
    return <p className="fn-alert manage-readonly-alert">
      この画面は閲覧のみです。メンバーの追加・編集には event.members 権限が必要です。
    </p>;
  }

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
        <PermissionAssignment initialPreset="manager" initialKeys={[]} isSiteAdmin={isSiteAdmin} busy={busy}/>
        <select name="is_public" defaultValue="0" className="fn-select" disabled={busy}>
          <option value="0">非公開</option><option value="1">公開</option>
        </select>
        <input className="fn-input" name="public_role_label" maxLength={40} placeholder="公開肩書" disabled={busy}/>
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
              <PermissionAssignment initialPreset={member.permission_preset}
                initialKeys={member.permission_keys} isSiteAdmin={isSiteAdmin} busy={busy}
                lockOwner={isLastOwner}/>
              <label className="fn-label">公開状態
                <select name="is_public" className="fn-select" defaultValue={String(member.is_public ?? 0)} disabled={busy}>
                  <option value="0">非公開</option><option value="1">公開</option>
                </select>
              </label>
              <label className="fn-label">公開肩書
                <input className="fn-input" name="public_role_label"
                  defaultValue={member.public_role_label ?? ""} maxLength={40} disabled={busy}/>
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
      <StaffCsvImport key={contextEpochRef.current}
        members={members}
        isSiteAdmin={isSiteAdmin}
        busy={busy}
        onImport={(reason, rows) => run(() => client.importCsv(eventId, reason, rows))}
      />
    </details>
  </section>;
}
