import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(path, from, to) {
  const source = read(path);
  const count = source.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`${path}: expected exactly one match, got ${count}`);
  }
  write(path, source.replace(from, to));
}

function replaceTail(path, marker, replacement) {
  const source = read(path);
  const index = source.indexOf(marker);
  if (index < 0) throw new Error(`${path}: marker not found: ${marker}`);
  write(path, `${source.slice(0, index)}${replacement}`);
}

// --- slot.ts: user-friendly precheck + fail-closed atomic post-update guard ---
{
  const path = "src/lib/actions/slot.ts";
  replaceOnce(
    path,
    'import { enqueueSlotReserveOpsWebhookPostCommit } from "@/lib/actions/slotNotificationsPostCommit";\n',
    'import { enqueueSlotReserveOpsWebhookPostCommit } from "@/lib/actions/slotNotificationsPostCommit";\nimport {\n  buildReservationLimitGuardStatement,\n  loadLogicalReservationCountForXId,\n} from "@/lib/slots/slotReservationLimitGuard";\nimport {\n  normalizeSlotReservationLimit,\n  slotReservationLimitMessage,\n} from "@/lib/slots/slotReservationLimit";\n',
  );

  replaceOnce(
    path,
    '      `連続枠が上限 ${MAX_ATOMIC_SLOT_ROWS} 件を超えています。運営へ連絡してください。`,\n',
    '      `連続枠が上限 ${MAX_ATOMIC_SLOT_ROWS} 件を超えています。運営へ連絡してください。`,\n      `連続枠が上限 ${MAX_SLOTS_PER_VIDEO} 件を超えています。運営へ連絡してください。`,\n',
  );

  replaceOnce(
    path,
    '  const wakeNotification =\n    args.notificationWakeSource ?? (extra.length > 0 ? "web" : undefined);\n',
    '  // extraStatements には通知以外の atomic guard も入る。\n  // extra の有無だけで通知 Queue を wake すると無料枠を無駄に消費するため、\n  // 実際に通知 outbox を追加した呼び出しだけ wake する。\n  const wakeNotification = args.notificationWakeSource;\n',
  );

  replaceOnce(
    path,
    '    if (parsed.data.consecutive_count > maxRows) {\n      return {\n        ok: false,\n        message: `一度に確保できる連続枠は ${maxRows} 件までです。`,\n      };\n    }\n\n    const targetRows = [anchor];\n',
    '    if (parsed.data.consecutive_count > maxRows) {\n      return {\n        ok: false,\n        message: `一度に確保できる連続枠は ${maxRows} 件までです。`,\n      };\n    }\n\n    // X ID ごとの上限は新しい logical reservation を作る reserve だけで増える。\n    // 事前チェックは分かりやすいエラー表示用。競合安全性は後段の同一 D1 batch\n    // 内 guard が担保する。Discord-only は X ID 制限の対象外。\n    const xidReservationLimit = operatorOverride\n      ? 0\n      : normalizeSlotReservationLimit(\n          event.max_slot_reservation_groups_per_xid,\n        );\n    if (xidReservationLimit > 0 && identity.snapshotXId) {\n      const currentLogicalReservations = await loadLogicalReservationCountForXId(\n        db,\n        { eventId: anchor.event_id, xIdSnapshot: identity.snapshotXId },\n      );\n      if (currentLogicalReservations >= xidReservationLimit) {\n        return {\n          ok: false,\n          message: slotReservationLimitMessage(xidReservationLimit),\n        };\n      }\n    }\n\n    const targetRows = [anchor];\n',
  );

  replaceOnce(
    path,
    '    const extraStatements: BatchItem<"sqlite">[] = [];\n    let notificationWakeSource: "web" | undefined;\n    if (channelNotification) {\n      extraStatements.push(channelNotification.statement);\n      notificationWakeSource = "web";\n    }\n    await commitSlotMutationPlan({\n      db,\n      mutations: [\n        {\n          rows: targetRows,\n          patch: reservePatch,\n          statusGuard: "available",\n        },\n      ],\n      eventId: anchor.event_id,\n      actorUserId: guard.user.id,\n      reason: "slot_user_reserve",\n      extraStatements,\n      notificationWakeSource,\n    });\n',
    '    const extraStatements: BatchItem<"sqlite">[] = [];\n    let notificationWakeSource: "web" | undefined;\n    if (channelNotification) {\n      extraStatements.push(channelNotification.statement);\n      notificationWakeSource = "web";\n    }\n    const reservationLimitGuard = buildReservationLimitGuardStatement(db, {\n      eventId: anchor.event_id,\n      xIdSnapshot: identity.snapshotXId,\n      limit: xidReservationLimit,\n    });\n    if (reservationLimitGuard) {\n      // slot UPDATE 後に評価することで、同時 reserve でも上限突破側の\n      // D1 batch 全体（slot / audit / queue / notification）を rollback する。\n      extraStatements.push(reservationLimitGuard);\n    }\n    try {\n      await commitSlotMutationPlan({\n        db,\n        mutations: [\n          {\n            rows: targetRows,\n            patch: reservePatch,\n            statusGuard: "available",\n          },\n        ],\n        eventId: anchor.event_id,\n        actorUserId: guard.user.id,\n        reason: "slot_user_reserve",\n        extraStatements,\n        notificationWakeSource,\n      });\n    } catch (error) {\n      // race で atomic guard に負けた場合だけ再確認し、generic error ではなく\n      // 上限理由を返す。通常成功時の D1 read は増やさない。\n      if (xidReservationLimit > 0 && identity.snapshotXId) {\n        try {\n          const currentLogicalReservations =\n            await loadLogicalReservationCountForXId(db, {\n              eventId: anchor.event_id,\n              xIdSnapshot: identity.snapshotXId,\n            });\n          if (currentLogicalReservations >= xidReservationLimit) {\n            return {\n              ok: false,\n              message: slotReservationLimitMessage(xidReservationLimit),\n            };\n          }\n        } catch {\n          // 元の atomic mutation error を優先する。\n        }\n      }\n      throw error;\n    }\n',
  );
}

// --- public slot page: pass limit and inferred interval without another D1 query ---
{
  const path = "app/(public)/event/[id]/slots/page.tsx";
  replaceOnce(
    path,
    'import { canUseSlotOperatorOverride } from "@/lib/slots/operatorReservationCore";\n',
    'import { canUseSlotOperatorOverride } from "@/lib/slots/operatorReservationCore";\nimport { resolveSlotIntervalSec } from "@/lib/slots/slotGuidance";\n',
  );
  replaceOnce(
    path,
    '          max_slots_per_video: eventsTable.max_slots_per_video,\n          slot_part_gap_minutes: eventsTable.slot_part_gap_minutes,\n',
    '          max_slots_per_video: eventsTable.max_slots_per_video,\n          max_slot_reservation_groups_per_xid:\n            eventsTable.max_slot_reservation_groups_per_xid,\n          slot_interval_minutes: eventsTable.slot_interval_minutes,\n          slot_part_gap_minutes: eventsTable.slot_part_gap_minutes,\n',
  );
  replaceOnce(
    path,
    '  const slotPartGapSec = (event.slot_part_gap_minutes ?? 15) * 60;\n\n  let viewerXId: string | null = null;\n',
    '  const slotPartGapSec = (event.slot_part_gap_minutes ?? 15) * 60;\n  const slotIntervalSec =\n    event.slot_type === "count"\n      ? null\n      : resolveSlotIntervalSec({\n          explicitMinutes: event.slot_interval_minutes,\n          slots: slotRows,\n          partGapSec: slotPartGapSec,\n        });\n\n  let viewerXId: string | null = null;\n',
  );
  replaceOnce(
    path,
    '            maxSlotsPerVideo={event.max_slots_per_video ?? 1}\n            slotPartGapSec={slotPartGapSec}\n',
    '            maxSlotsPerVideo={event.max_slots_per_video ?? 1}\n            maxSlotReservationsPerXId={\n              event.max_slot_reservation_groups_per_xid ?? 0\n            }\n            slotIntervalSec={slotIntervalSec}\n            slotPartGapSec={slotPartGapSec}\n',
  );
}

// --- SlotGrid: explain logical limit and the 75% consecutive-slot rule ---
{
  const path = "src/components/event/SlotGrid.tsx";
  replaceOnce(
    path,
    'import { computeFloatingMenuPosition } from "@/lib/ui/floatingMenuPosition";\n',
    'import { computeFloatingMenuPosition } from "@/lib/ui/floatingMenuPosition";\nimport { buildConsecutiveSlotGuidance } from "@/lib/slots/slotGuidance";\nimport {\n  normalizeSlotReservationLimit,\n  slotReservationLimitMessage,\n} from "@/lib/slots/slotReservationLimit";\n',
  );
  replaceOnce(
    path,
    '  maxSlotsPerVideo?: number;\n  /** event.slots を持つ運営スタッフ／adminの例外予約を許可する表示フラグ。 */\n',
    '  maxSlotsPerVideo?: number;\n  /** 1 X ID あたりの logical reservation 上限。0 は無制限。 */\n  maxSlotReservationsPerXId?: number;\n  /** 連続枠ガイダンス用の実際の枠間隔。time型で判定不能なら null。 */\n  slotIntervalSec?: number | null;\n  /** event.slots を持つ運営スタッフ／adminの例外予約を許可する表示フラグ。 */\n',
  );
  replaceOnce(
    path,
    '  slotType,\n  maxSlotsPerVideo = 1,\n  slotPartGapSec,\n',
    '  slotType,\n  maxSlotsPerVideo = 1,\n  maxSlotReservationsPerXId = 0,\n  slotIntervalSec = null,\n  slotPartGapSec,\n',
  );
  replaceOnce(
    path,
    '  const slotGapSec = slotPartGapSec ?? 15 * 60;\n\n  const redirectForGuardReason = React.useCallback(\n',
    '  const slotGapSec = slotPartGapSec ?? 15 * 60;\n  const xidReservationLimit = normalizeSlotReservationLimit(\n    maxSlotReservationsPerXId,\n  );\n  const consecutiveGuidance = buildConsecutiveSlotGuidance(\n    slotType === "time" ? slotIntervalSec : null,\n  );\n\n  const redirectForGuardReason = React.useCallback(\n',
  );
  replaceOnce(
    path,
    '                <p className={styles.reserveDialogHint}>\n                  連続枠は空きが隣接している場合だけまとめて確保されます。上限は {eventMaxSlots} 枠です。\n                </p>\n',
    '                <p className={styles.reserveDialogHint}>\n                  {consecutiveGuidance} 連続上限は {eventMaxSlots} 枠です。\n                </p>\n                {Number(reserveCount) >= 2 ? (\n                  <p className={styles.reserveDialogHint}>\n                    <strong>この選択は1作品分です。</strong>{" "}\n                    別作品を投稿する場合は、作品ごとに別の枠を確保してください。\n                  </p>\n                ) : null}\n',
  );
  replaceOnce(
    path,
    '            <div className={styles.reserveDialogField}>\n              <p className={styles.reserveDialogHint}>\n                取得名義:{" "}\n                <strong>{reserveDisplayName.trim() || "未入力"}</strong>\n              </p>\n              {viewerXId ? (\n',
    '            <div className={styles.reserveDialogField}>\n              <p className={styles.reserveDialogHint}>\n                取得名義:{" "}\n                <strong>{reserveDisplayName.trim() || "未入力"}</strong>\n              </p>\n              {viewerXId && xidReservationLimit > 0 ? (\n                <p className={styles.reserveDialogHint}>\n                  {slotReservationLimitMessage(xidReservationLimit)}\n                </p>\n              ) : null}\n              {viewerXId ? (\n',
  );
}

// --- EventStaffManager: Japanese permission metadata is the UI source of truth ---
{
  const path = "src/components/admin/EventStaffManager.tsx";
  replaceOnce(
    path,
    '  ALL_PERMISSION_KEYS,\n  isAdminOnlyKey,\n  type PermissionKey,\n',
    '  ALL_PERMISSION_KEYS,\n  PERMISSION_DEFINITIONS,\n  isAdminOnlyKey,\n  type PermissionCategory,\n  type PermissionKey,\n',
  );
  replaceOnce(
    path,
    'function permissionKeysForPreset(\n  preset: EventStaffPreset,\n  customKeys: readonly string[],\n): string[] {\n  return preset === "custom" ? [...customKeys] : [...getPresetPermissions(preset)];\n}\n\n',
    'function permissionKeysForPreset(\n  preset: EventStaffPreset,\n  customKeys: readonly string[],\n): string[] {\n  return preset === "custom" ? [...customKeys] : [...getPresetPermissions(preset)];\n}\n\nconst PERMISSION_CATEGORY_LABELS: Record<PermissionCategory, string> = {\n  event: "イベント",\n  video: "作品",\n  xid: "X ID",\n  danger: "高度・危険な操作",\n};\n\nfunction PresetPermissionSummary({\n  preset,\n  isSiteAdmin,\n}: {\n  preset: EventStaffPreset;\n  isSiteAdmin: boolean;\n}): React.ReactElement {\n  const permissions = getPresetPermissions(preset).filter(\n    (key) => isSiteAdmin || !isAdminOnlyKey(key),\n  );\n  return (\n    <div className="fn-console-note" style={{ margin: 0, display: "grid", gap: 8 }}>\n      <span>{PRESET_DEFINITIONS[preset].description}</span>\n      {permissions.length > 0 ? (\n        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>\n          {permissions.map((key) => {\n            const definition = PERMISSION_DEFINITIONS[key];\n            return (\n              <span\n                key={key}\n                className={`fn-badge ${\n                  definition.dangerous ? "fn-badge-warning" : "fn-badge-soft"\n                }`}\n                title={definition.description}\n              >\n                {definition.label}\n              </span>\n            );\n          })}\n        </div>\n      ) : (\n        <span className="fn-muted">内部操作権限はありません。</span>\n      )}\n    </div>\n  );\n}\n\n',
  );
  replaceOnce(
    path,
    '      ) : (\n        <p className="fn-console-note" style={{ margin: 0 }}>\n          {PRESET_DEFINITIONS[preset].description}（\n          {permissionKeysForPreset(preset, []).length}権限）\n        </p>\n      )}\n',
    '      ) : (\n        <PresetPermissionSummary preset={preset} isSiteAdmin={isSiteAdmin} />\n      )}\n',
  );
  replaceOnce(
    path,
    '        {preset === "custom" ? (\n          <PermissionChecklist\n            isSiteAdmin={isSiteAdmin}\n            selected={customKeys}\n            onChange={setCustomKeys}\n            disabled={busy}\n          />\n        ) : null}\n',
    '        {preset === "custom" ? (\n          <PermissionChecklist\n            isSiteAdmin={isSiteAdmin}\n            selected={customKeys}\n            onChange={setCustomKeys}\n            disabled={busy}\n          />\n        ) : (\n          <PresetPermissionSummary preset={preset} isSiteAdmin={isSiteAdmin} />\n        )}\n',
  );

  replaceTail(
    path,
    'function PermissionChecklist({',
    `function PermissionChecklist({\n  isSiteAdmin,\n  selected,\n  onChange,\n  disabled,\n}: {\n  isSiteAdmin: boolean;\n  selected: string[];\n  onChange: (keys: string[]) => void;\n  disabled: boolean;\n}): React.ReactElement {\n  const selectedSet = new Set(selected);\n  const keys = ALL_PERMISSION_KEYS.filter(\n    (key) => isSiteAdmin || !isAdminOnlyKey(key),\n  );\n  const categoryOrder: PermissionCategory[] = [\n    "event",\n    "video",\n    "xid",\n    "danger",\n  ];\n\n  return (\n    <div className="manage-permission-checklist" style={{ display: "grid", gap: 12 }}>\n      {categoryOrder.map((category) => {\n        const categoryKeys = keys.filter(\n          (key) => PERMISSION_DEFINITIONS[key].category === category,\n        );\n        if (categoryKeys.length === 0) return null;\n        return (\n          <fieldset key={category} style={{ border: 0, padding: 0, margin: 0 }}>\n            <legend className="fn-console-note" style={{ marginBottom: 6, fontWeight: 700 }}>\n              {PERMISSION_CATEGORY_LABELS[category]}\n            </legend>\n            <div style={{ display: "grid", gap: 8 }}>\n              {categoryKeys.map((key: PermissionKey) => {\n                const definition = PERMISSION_DEFINITIONS[key];\n                return (\n                  <label\n                    key={key}\n                    className="fn-label"\n                    style={{\n                      display: "grid",\n                      gridTemplateColumns: "auto 1fr auto",\n                      alignItems: "start",\n                      gap: 8,\n                    }}\n                  >\n                    <input\n                      type="checkbox"\n                      checked={selectedSet.has(key)}\n                      disabled={disabled}\n                      onChange={(event) =>\n                        onChange(\n                          event.target.checked\n                            ? [...selectedSet, key]\n                            : selected.filter((item) => item !== key),\n                        )\n                      }\n                    />\n                    <span style={{ display: "grid", gap: 2 }}>\n                      <strong>{definition.label}</strong>\n                      <span className="fn-muted fn-text-sm">\n                        {definition.description}\n                      </span>\n                    </span>\n                    {definition.dangerous ? (\n                      <span className="fn-badge fn-badge-warning">注意</span>\n                    ) : null}\n                  </label>\n                );\n              })}\n            </div>\n          </fieldset>\n        );\n      })}\n    </div>\n  );\n}\n`,
  );
}

// --- Event settings preview: remove internal field names from normal UI ---
{
  const path = "src/components/admin/EventSettingsPreview.tsx";
  replaceOnce(path, 'label="許可キー"', 'label="一般作品の編集許可"');
  replaceOnce(path, 'label="editable_fields"', 'label="編集対象フィールド"');
  replaceOnce(path, 'label="review_settings"', 'label="審査設定"');
}

// --- YouTube template editor: make controlled value survive draft restore/buttons ---
{
  const path = "src/components/admin/YoutubeDescriptionTemplateEditor.tsx";
  replaceOnce(
    path,
    'export function YoutubeDescriptionTemplateEditor({\n  defaultValue,\n  eventTitle,\n  disabled = false,\n}: {\n  defaultValue: string;\n  eventTitle?: string | null;\n  disabled?: boolean;\n}): React.ReactElement {\n  const [value, setValue] = React.useState(defaultValue);\n',
    'export function YoutubeDescriptionTemplateEditor({\n  value,\n  onChange,\n  eventTitle,\n  disabled = false,\n}: {\n  value: string;\n  onChange: (value: string) => void;\n  eventTitle?: string | null;\n  disabled?: boolean;\n}): React.ReactElement {\n',
  );
  replaceOnce(
    path,
    '  const setTextareaValue = React.useCallback((next: string, caret?: number) => {\n    setValue(next);\n    window.requestAnimationFrame(() => {\n',
    '  const setTextareaValue = React.useCallback((next: string, caret?: number) => {\n    onChange(next);\n    window.requestAnimationFrame(() => {\n',
  );
  replaceOnce(path, '  }, []);\n\n  const insertVariable', '  }, [onChange]);\n\n  const insertVariable');
  replaceOnce(
    path,
    '          onChange={(event) => setValue(event.target.value)}\n',
    '          onChange={(event) => onChange(event.target.value)}\n',
  );
}

// --- EventForm: own the controlled template value so drafts and GUI buttons are persisted ---
{
  const path = "src/components/admin/EventForm.tsx";
  replaceOnce(
    path,
    '  const [success, setSuccess] = React.useState<{\n    message: string;\n    pendingPublicReflection?: boolean;\n  } | null>(null);\n  const [preview, setPreview]',
    '  const [success, setSuccess] = React.useState<{\n    message: string;\n    pendingPublicReflection?: boolean;\n  } | null>(null);\n  const [youtubeDescriptionTemplate, setYoutubeDescriptionTemplate] =\n    React.useState(initial.youtube_description_template ?? "");\n  const [preview, setPreview]',
  );
  replaceOnce(
    path,
    '    setQuestions(\n      filterImplicitEmptyStagePermissionQuestions(readQuestions(restored)),\n    );\n    setPreview(formPreview(restored, initial));\n',
    '    setYoutubeDescriptionTemplate(\n      textValue(restored, "youtube_description_template"),\n    );\n    setQuestions(\n      filterImplicitEmptyStagePermissionQuestions(readQuestions(restored)),\n    );\n    setPreview(formPreview(restored, initial));\n',
  );
  replaceOnce(
    path,
    '    void preview;\n    void questions;\n',
    '    void preview;\n    void questions;\n    void youtubeDescriptionTemplate;\n',
  );
  replaceOnce(path, '  }, [preview, questions]);\n', '  }, [preview, questions, youtubeDescriptionTemplate]);\n');
  replaceOnce(
    path,
    '        <YoutubeDescriptionTemplateEditor\n          defaultValue={initial.youtube_description_template ?? ""}\n          eventTitle={preview.title}\n          disabled={!canBasic}\n        />\n',
    '        <YoutubeDescriptionTemplateEditor\n          value={youtubeDescriptionTemplate}\n          onChange={(next) => {\n            setYoutubeDescriptionTemplate(next);\n            setDirty(true);\n          }}\n          eventTitle={preview.title}\n          disabled={!canBasic}\n        />\n',
  );
}

// --- Lightweight repository contract tests (no network / no DB required) ---
fs.writeFileSync(
  "src/lib/slots/slotReservationLimit.contract.test.mjs",
  `import test from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst slotAction = fs.readFileSync("src/lib/actions/slot.ts", "utf8");\nconst migration = fs.readFileSync("migrations/0059_event_slot_reservation_limits.sql", "utf8");\nconst schema = fs.readFileSync("src/lib/db/schema.canonical.ts", "utf8");\n\ntest("X ID limit uses slots as source of truth and an atomic post-update guard", () => {\n  assert.match(slotAction, /loadLogicalReservationCountForXId/);\n  assert.match(slotAction, /buildReservationLimitGuardStatement/);\n  assert.match(slotAction, /extraStatements\\.push\\(reservationLimitGuard\\)/);\n  assert.match(slotAction, /status IN \\('reserved', 'submitted'\\)/);\n  assert.doesNotMatch(migration, /slot_reservation_subject_counts/);\n  assert.doesNotMatch(schema, /slotReservationSubjectCounts/);\n});\n\ntest("notification queue is not woken by a non-notification guard", () => {\n  assert.match(slotAction, /const wakeNotification = args\\.notificationWakeSource;/);\n  assert.doesNotMatch(slotAction, /extra\\.length > 0 \\? "web"/);\n});\n\ntest("migration keeps existing events backward compatible and indexes the hot path", () => {\n  assert.match(migration, /max_slot_reservation_groups_per_xid INTEGER NOT NULL DEFAULT 0/);\n  assert.match(migration, /slot_interval_minutes INTEGER/);\n  assert.match(migration, /slots_event_x_snapshot_active_group_idx/);\n});\n`,
);

fs.writeFileSync(
  "src/components/admin/eventUxEnhancements.contract.test.mjs",
  `import test from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst staff = fs.readFileSync("src/components/admin/EventStaffManager.tsx", "utf8");\nconst editor = fs.readFileSync("src/components/admin/YoutubeDescriptionTemplateEditor.tsx", "utf8");\nconst form = fs.readFileSync("src/components/admin/EventForm.tsx", "utf8");\nconst grid = fs.readFileSync("src/components/event/SlotGrid.tsx", "utf8");\n\ntest("permission UI uses Japanese definitions instead of raw keys", () => {\n  assert.match(staff, /PERMISSION_DEFINITIONS/);\n  assert.match(staff, /definition\\.label/);\n  assert.match(staff, /definition\\.description/);\n  assert.doesNotMatch(staff, /\\{key\\}\\s*<\\/label>/);\n});\n\ntest("YouTube template editor is controlled and GUI changes participate in form drafts", () => {\n  assert.match(editor, /value: string;/);\n  assert.match(editor, /onChange: \\(value: string\\) => void;/);\n  assert.match(form, /youtubeDescriptionTemplate/);\n  assert.match(form, /setYoutubeDescriptionTemplate/);\n});\n\ntest("consecutive slot UX explains one-work semantics and X ID limit", () => {\n  assert.match(grid, /buildConsecutiveSlotGuidance/);\n  assert.match(grid, /この選択は1作品分です/);\n  assert.match(grid, /slotReservationLimitMessage/);\n});\n`,
);

fs.writeFileSync(
  "src/lib/publicData/topSlotStatsTtl.contract.test.mjs",
  `import test from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst web = fs.readFileSync("src/lib/publicData/publicJsonCacheTtl.ts", "utf8");\nconst worker = fs.readFileSync("workers/shared/staticR2CacheControl.ts", "utf8");\n\ntest("top slot stats stay fresh without shortening the whole top artifact", () => {\n  for (const source of [web, worker]) {\n    assert.match(source, /top: 600/);\n    assert.match(source, /topSlotStats: 30/);\n  }\n});\n`,
);

console.log("finish-event-ux: applied remaining implementation");
