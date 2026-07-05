import type { Miniflare as MiniflareType } from "miniflare";

/**
 * Next.js が起動時に呼ぶフック。
 *
 * Windows などローカル開発で `wrangler pages dev` が安定しないケースに備え、
 * `next dev` プロセス内に Miniflare を 1 回だけ立ち上げて
 * D1 / R2 / KV を `globalThis` 経由で `src/lib/cloudflare.ts` から参照できるようにする。
 *
 * - 本番 (`process.env.NEXT_RUNTIME !== 'nodejs'`) では Miniflare を起動しない。
 *   Cloudflare Pages の本番ランタイムが純正の bindings を提供する。
 * - 環境変数 `LOCAL_BINDINGS=0` で明示的にスキップできる。
 * - `.wrangler/state/v3` を共有 persist root にするため、
 *   `wrangler d1 migrations apply --local` で作った SQLite と同じファイルを再利用する。
 *
 * 実装メモ: Webpack に Miniflare (Node 組み込みモジュール依存) を bundle させないため、
 * `eval('require')` 経由で動的ロードする。`import type` は実行時に消える。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const req = eval("require") as NodeRequire;
    req("./scripts/load-dev-vars.cjs");
  } catch {
    /* dev preload 済みなら無視 */
  }

  if (process.env.LOCAL_BINDINGS === "0") return;
  if (
    process.argv.some((arg) => arg.includes("build")) ||
    process.env.npm_lifecycle_event === "build"
  ) return;

  const g = globalThis as Record<string | symbol, unknown>;
  if (g.__FLAMENODE_LOCAL_BINDINGS_READY) return;
  g.__FLAMENODE_LOCAL_BINDINGS_READY = true;

  const initPromise = (async () => {
    try {
      // Webpack の静的解析を避けるための動的 require
      const req = eval("require") as NodeRequire;
      const { Miniflare } = req("miniflare") as {
        Miniflare: new (opts: Record<string, unknown>) => MiniflareType;
      };

      const mf = new Miniflare({
        modules: true,
        script: "export default { fetch() { return new Response('ok'); } }",
        d1Databases: { DB: "flamenode_db" },
        r2Buckets: { BUCKET: "flamenode-storage" },
        kvNamespaces: { KV: "FLAMENODE_KV" },
        // wrangler --local が使う persist 先と揃える
        d1Persist: ".wrangler/state/v3/d1",
        r2Persist: ".wrangler/state/v3/r2",
        kvPersist: ".wrangler/state/v3/kv",
      });

      const [DB, BUCKET, KV] = await Promise.all([
        mf.getD1Database("DB"),
        mf.getR2Bucket("BUCKET"),
        mf.getKVNamespace("KV"),
      ]);

      // 必要に応じてマイグレーションを apply (テーブルが無い場合のみ)
      await applyMigrationsIfNeeded(DB);

      g.__FLAMENODE_LOCAL_BINDINGS = { DB, BUCKET, KV };
      g.__FLAMENODE_LOCAL_MINIFLARE = mf;
      console.log(
        "[instrumentation] Local bindings ready: DB, BUCKET, KV (Miniflare)",
      );
    } catch (e) {
      g.__FLAMENODE_LOCAL_BINDINGS_READY = false;
      console.error("[instrumentation] Failed to initialize Miniflare:", e);
    }
  })();
  g.__FLAMENODE_LOCAL_BINDINGS_PROMISE = initPromise;
  await initPromise;
}

/**
 * Miniflare のローカル D1 にマイグレーションを冪等に当てる。
 * `user` テーブルが既に存在しても、後続 migration の追加列/index は補修する。
 */
type LocalD1Statement = {
  first: () => Promise<unknown>;
  run: () => Promise<unknown>;
  all: <T = unknown>() => Promise<{ results?: T[] }>;
  bind: (...values: unknown[]) => LocalD1Statement;
};

type LocalD1Database = {
  prepare: (sql: string) => LocalD1Statement;
  exec: (sql: string) => Promise<unknown>;
};

async function applyMigrationsIfNeeded(DB: LocalD1Database): Promise<void> {
  try {
    const existing = await DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='user' LIMIT 1",
    ).first();
    if (existing) {
      await repairLocalSchemaDrift(DB);
      return;
    }
  } catch {
    // sqlite_master が無いことは無いが、安全側に倒して続行
  }

  const req = eval("require") as NodeRequire;
  const fs = req("node:fs") as typeof import("node:fs");
  const path = req("node:path") as typeof import("node:path");

  const dir = path.join(process.cwd(), "migrations");
  if (!fs.existsSync(dir)) {
    console.warn(
      "[instrumentation] migrations dir not found; skipped schema setup",
    );
    return;
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    await applyMigrationFile(DB, file);
  }

  // 初期 system_settings
  try {
    await DB.prepare(
      "INSERT OR REPLACE INTO system_settings (id, operation_mode, auto_cost_guard_enabled, is_maintenance_mode, history_retention_days) VALUES ('default', 'normal', 1, 0, 90)",
    ).run();
  } catch {
    /* noop */
  }

  await repairLocalSchemaDrift(DB);
}

async function applyMigrationFile(
  DB: LocalD1Database,
  file: string,
): Promise<void> {
  const req = eval("require") as NodeRequire;
  const fs = req("node:fs") as typeof import("node:fs");
  const path = req("node:path") as typeof import("node:path");
  const fullPath = path.join(process.cwd(), "migrations", file);
  if (!fs.existsSync(fullPath)) {
    console.warn(`[instrumentation] migration file not found: ${file}`);
    return;
  }

  const sqlText = fs.readFileSync(fullPath, "utf8");
  const statements = sqlText
    .split(/-->\s*statement-breakpoint\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    try {
      await DB.prepare(stmt).run();
    } catch (e) {
      console.error(
        `[instrumentation] migration error in ${file}:`,
        (e as Error).message,
      );
    }
  }
  console.log(`[instrumentation] Applied migration: ${file}`);
}

async function repairLocalSchemaDrift(DB: LocalD1Database): Promise<void> {
  // ローカル開発用の救済処理。
  // 本番 D1 にはこの補修は走らないため、正式な差分管理は migrations/*.sql と
  // docs/operations.md の適用順を正とする。ここだけに存在する補修を
  // 本番 migration の代替として扱わないこと。
  if (
    (await tableExists(DB, "videos")) &&
    !(await columnExists(DB, "videos", "creator_x_user_id"))
  ) {
    console.log("[instrumentation] Repairing local videos schema with 0018");
    await applyMigrationFile(DB, "0018_simplify_video_schema.sql");
  }

  if (
    (await tableExists(DB, "videos")) &&
    ((await columnExists(DB, "videos", "used_software")) ||
      !(await tableExists(DB, "video_softwares")) ||
      !(await tableExists(DB, "event_staff")))
  ) {
    console.log("[instrumentation] Repairing local staff/software schema with 0019");
    await applyMigrationFile(
      DB,
      "0019_clean_staff_software_and_disabled_features.sql",
    );
  }

  if (
    (await tableExists(DB, "videos")) &&
    (!(await columnExists(DB, "videos", "collaboration_type")) ||
      (await columnExists(DB, "videos", "view_count")) ||
      !(await tableExists(DB, "video_stats")) ||
      !(await tableExists(DB, "video_youtube_metadata")))
  ) {
    console.log("[instrumentation] Repairing local slim video schema with 0020");
    await applyMigrationFile(DB, "0020_split_video_core_metadata_stats.sql");
  }

  if (await tableExists(DB, "events")) {
    await ensureColumn(
      DB,
      "events",
      "parts_json",
      "ALTER TABLE `events` ADD `parts_json` text",
    );
    await ensureColumn(
      DB,
      "events",
      "entry_start_time",
      "ALTER TABLE `events` ADD `entry_start_time` integer",
    );
    await ensureColumn(
      DB,
      "events",
      "entry_end_time",
      "ALTER TABLE `events` ADD `entry_end_time` integer",
    );
    await ensureColumn(
      DB,
      "events",
      "allow_user_video_edits",
      "ALTER TABLE `events` ADD `allow_user_video_edits` integer NOT NULL DEFAULT 0",
    );
    await ensureColumn(
      DB,
      "events",
      "user_video_edit_permission_keys_json",
      "ALTER TABLE `events` ADD `user_video_edit_permission_keys_json` text",
    );
    await ensureColumn(
      DB,
      "events",
      "video_form_settings_json",
      "ALTER TABLE `events` ADD `video_form_settings_json` text",
    );
    await ensureColumn(
      DB,
      "events",
      "visibility_status",
      "ALTER TABLE `events` ADD `visibility_status` text NOT NULL DEFAULT 'draft'",
    );
    if (
      (await columnExists(DB, "events", "is_archived")) &&
      (await columnExists(DB, "events", "is_active"))
    ) {
      await runOptionalSql(
        DB,
        `UPDATE \`events\`
SET \`visibility_status\` = CASE
  WHEN \`is_archived\` = 1 THEN 'archived'
  WHEN \`is_active\` = 1 THEN 'public'
  ELSE 'draft'
END
WHERE \`visibility_status\` = 'draft'`,
        "backfill local events.visibility_status",
      );
    }
    await ensureIndex(
      DB,
      "CREATE INDEX IF NOT EXISTS `events_visibility_status_idx` ON `events` (`visibility_status`, `start_time`, `end_time`)",
      "events_visibility_status_idx",
    );
  }

  if (await tableExists(DB, "videos")) {
    await ensureColumn(
      DB,
      "videos",
      "creator_youtube_channel_url",
      "ALTER TABLE `videos` ADD `creator_youtube_channel_url` text",
    );
    await ensureColumn(
      DB,
      "videos",
      "part",
      "ALTER TABLE `videos` ADD `part` text",
    );
  }

  if (
    (await tableExists(DB, "events")) &&
    !(await tableExists(DB, "event_templates"))
  ) {
    console.log("[instrumentation] Applying event_templates migration 0022");
    await applyMigrationFile(DB, "0022_event_templates.sql");
  }

  if (!(await tableExists(DB, "static_rebuild_queue"))) {
    console.log("[instrumentation] Applying static_rebuild_queue migration 0023");
    await applyMigrationFile(DB, "0023_static_rebuild_queue.sql");
  }

  if (
    (await tableExists(DB, "videos")) &&
    !(await columnExists(DB, "videos", "used_software_json"))
  ) {
    console.log(
      "[instrumentation] Applying legacy import DB reduction prep migration 0024",
    );
    await applyMigrationFile(DB, "0024_legacy_import_db_reduction_prep.sql");
  }

  if (
    (await tableExists(DB, "videos")) &&
    (await tableExists(DB, "video_events")) &&
    (await tableExists(DB, "event_custom_questions")) &&
    (await tableExists(DB, "video_custom_answers")) &&
    (await columnExists(DB, "videos", "stage_permission"))
  ) {
    console.log(
      "[instrumentation] Backfilling local stage_permission answers with 0037",
    );
    await applyMigrationFile(
      DB,
      "0037_backfill_stage_permission_custom_answers.sql",
    );
  }

  if (await tableExists(DB, "notification_outbox")) {
    await ensureColumn(
      DB,
      "notification_outbox",
      "event_id",
      "ALTER TABLE `notification_outbox` ADD `event_id` text",
    );
    await ensureIndex(
      DB,
      "CREATE INDEX IF NOT EXISTS `notification_outbox_status_created_idx` ON `notification_outbox` (`status`,`created_at`)",
      "notification_outbox_status_created_idx",
    );
    await ensureIndex(
      DB,
      "CREATE INDEX IF NOT EXISTS `notification_outbox_event_idx` ON `notification_outbox` (`event_id`)",
      "notification_outbox_event_idx",
    );
    await ensureColumn(
      DB,
      "notification_outbox",
      "dedupe_key",
      "ALTER TABLE `notification_outbox` ADD `dedupe_key` text",
    );
    await ensureIndex(
      DB,
      "CREATE INDEX IF NOT EXISTS `notification_outbox_dedupe_idx` ON `notification_outbox` (`dedupe_key`)",
      "notification_outbox_dedupe_idx",
    );
  }

  if (await tableExists(DB, "x_users")) {
    await ensureColumn(
      DB,
      "x_users",
      "portfolio_contact",
      "ALTER TABLE `x_users` ADD `portfolio_contact` text",
    );
  }

  if (await tableExists(DB, "user")) {
    await ensureColumn(
      DB,
      "user",
      "can_create_events",
      "ALTER TABLE `user` ADD `can_create_events` integer NOT NULL DEFAULT 0",
    );
  }

  if (await tableExists(DB, "event_staff")) {
    await ensureColumn(
      DB,
      "event_staff",
      "permission_preset",
      "ALTER TABLE `event_staff` ADD `permission_preset` text NOT NULL DEFAULT 'public_staff'",
    );
    await ensureColumn(
      DB,
      "event_staff",
      "custom_permission_keys_json",
      "ALTER TABLE `event_staff` ADD `custom_permission_keys_json` text",
    );
    if (await columnExists(DB, "event_staff", "role")) {
      await runOptionalSql(
        DB,
        `UPDATE \`event_staff\`
SET \`permission_preset\` = CASE
  WHEN \`role\` = 'representative' THEN 'owner'
  WHEN \`role\` = 'editor' THEN 'manager'
  ELSE \`permission_preset\`
END
WHERE \`permission_preset\` = 'public_staff'`,
        "backfill local event_staff.permission_preset",
      );
    }
    await ensureIndex(
      DB,
      "CREATE INDEX IF NOT EXISTS `event_staff_event_idx` ON `event_staff` (`event_id`)",
      "event_staff_event_idx",
    );
    await ensureIndex(
      DB,
      "CREATE INDEX IF NOT EXISTS `event_staff_public_idx` ON `event_staff` (`event_id`, `is_public`, `display_name`)",
      "event_staff_public_idx",
    );
  }

  if (!(await tableExists(DB, "event_group_events"))) {
    console.log("[instrumentation] Applying event_group_events migration 0028");
    await applyMigrationFile(DB, "0028_event_group_events.sql");
  }

  if (
    (await tableExists(DB, "events")) &&
    (await columnExists(DB, "events", "event_group_id"))
  ) {
    const legacy = (await DB.prepare(
      `SELECT COUNT(*) AS c FROM events
       WHERE event_group_id IS NOT NULL AND trim(event_group_id) <> ''`,
    ).first()) as { c?: number } | null;
    if (Number(legacy?.c ?? 0) > 0) {
      console.log("[instrumentation] Applying event_group legacy cleanup 0039");
      await applyMigrationFile(DB, "0039_event_group_legacy_cleanup.sql");
    }
  }

  if (
    (await tableExists(DB, "x_users")) &&
    !(await tableExists(DB, "x_user_youtube_channels"))
  ) {
    console.log("[instrumentation] Applying x_user_youtube_channels migration 0040");
    await applyMigrationFile(DB, "0040_x_user_youtube_channels.sql");
  }

  if (await tableExists(DB, "x_user_youtube_channels")) {
    console.log(
      "[instrumentation] Applying x_user_youtube_channels creator sync 0041",
    );
    await applyMigrationFile(DB, "0041_x_user_youtube_channels_creator_sync.sql");
  }

  if (
    (await tableExists(DB, "videos")) &&
    (await columnExists(DB, "videos", "creator_youtube_channel_url")) &&
    (await tableExists(DB, "x_user_youtube_channels"))
  ) {
    await runOptionalSql(
      DB,
      `UPDATE \`videos\`
SET \`creator_youtube_channel_url\` = (
  SELECT c.\`youtube_channel_url\`
  FROM \`x_user_youtube_channels\` c
  WHERE c.\`source_video_id\` = \`videos\`.\`id\`
  ORDER BY c.\`created_at\` DESC
  LIMIT 1
)
WHERE \`creator_youtube_channel_url\` IS NULL
  AND EXISTS (
    SELECT 1
    FROM \`x_user_youtube_channels\` c
    WHERE c.\`source_video_id\` = \`videos\`.\`id\`
  )`,
      "backfill local videos.creator_youtube_channel_url",
    );
  }

  if (await tableExists(DB, "system_settings")) {
    await ensureColumn(
      DB,
      "system_settings",
      "operation_mode",
      "ALTER TABLE `system_settings` ADD `operation_mode` text DEFAULT 'normal'",
    );
  }

  if (await tableExists(DB, "software_catalog")) {
    await ensureColumn(
      DB,
      "software_catalog",
      "usage_count",
      "ALTER TABLE `software_catalog` ADD `usage_count` integer NOT NULL DEFAULT 0",
    );
    await ensureColumn(
      DB,
      "software_catalog",
      "is_active",
      "ALTER TABLE `software_catalog` ADD `is_active` integer NOT NULL DEFAULT 1",
    );
    await ensureColumn(
      DB,
      "software_catalog",
      "is_verified",
      "ALTER TABLE `software_catalog` ADD `is_verified` integer NOT NULL DEFAULT 0",
    );
  }

  if (await tableExists(DB, "video_chapters")) {
    await ensureColumn(
      DB,
      "video_chapters",
      "video_member_id",
      "ALTER TABLE `video_chapters` ADD `video_member_id` text",
    );
    await ensureIndex(
      DB,
      "CREATE INDEX IF NOT EXISTS `video_chapters_video_member_idx` ON `video_chapters` (`video_member_id`)",
      "video_chapters_video_member_idx",
    );
  }

  // メンバーチャプターは video_members.chapters_json が正本。
  if (await tableExists(DB, "history_logs")) {
    await ensureColumn(
      DB,
      "history_logs",
      "operator_snapshot_json",
      "ALTER TABLE `history_logs` ADD `operator_snapshot_json` text",
    );
  }

  if (await tableExists(DB, "video_members")) {
    await ensureIndex(
      DB,
      "CREATE INDEX IF NOT EXISTS `video_members_video_order_idx` ON `video_members` (`video_id`,`order_index`)",
      "video_members_video_order_idx",
    );
    await ensureIndex(
      DB,
      "CREATE INDEX IF NOT EXISTS `video_members_video_name_idx` ON `video_members` (`video_id`,`name`)",
      "video_members_video_name_idx",
    );
    await ensureColumn(
      DB,
      "video_members",
      "chapters_json",
      "ALTER TABLE `video_members` ADD `chapters_json` text",
    );
    // Phase A (0016): 共同編集者カラム
    await ensureColumn(
      DB,
      "video_members",
      "discord_user_id",
      "ALTER TABLE `video_members` ADD `discord_user_id` text",
    );
    await ensureColumn(
      DB,
      "video_members",
      "can_edit",
      "ALTER TABLE `video_members` ADD `can_edit` integer NOT NULL DEFAULT 0",
    );
    await ensureColumn(
      DB,
      "video_members",
      "is_public_member",
      "ALTER TABLE `video_members` ADD `is_public_member` integer NOT NULL DEFAULT 1",
    );
    await ensureColumn(
      DB,
      "video_members",
      "edit_granted_by_user_id",
      "ALTER TABLE `video_members` ADD `edit_granted_by_user_id` text",
    );
    await ensureColumn(
      DB,
      "video_members",
      "edit_granted_at",
      "ALTER TABLE `video_members` ADD `edit_granted_at` integer",
    );
    await ensureColumn(
      DB,
      "video_members",
      "edit_updated_at",
      "ALTER TABLE `video_members` ADD `edit_updated_at` integer",
    );
    await ensureIndex(
      DB,
      "CREATE INDEX IF NOT EXISTS `video_members_video_can_edit_idx` ON `video_members` (`video_id`,`can_edit`)",
      "video_members_video_can_edit_idx",
    );
    await ensureIndex(
      DB,
      "CREATE INDEX IF NOT EXISTS `video_members_discord_idx` ON `video_members` (`discord_user_id`)",
      "video_members_discord_idx",
    );
  }

  if (!(await tableExists(DB, "event_custom_questions"))) {
    console.log("[instrumentation] Applying event_custom_questions migration 0027");
    await applyMigrationFile(DB, "0027_event_custom_questions_and_video_answers.sql");
  }

  if (!(await tableExists(DB, "audit_logs"))) {
    console.log("[instrumentation] Applying audit_logs migration 0043");
    await applyMigrationFile(DB, "0043_audit_logs.sql");
  }

  if (await tableExists(DB, "history_logs")) {
    console.log("[instrumentation] Applying db canonical cleanup migration 0044");
    await applyMigrationFile(DB, "0044_db_canonical_cleanup.sql");
  }

  if (
    (await tableExists(DB, "videos")) &&
    (await columnExists(DB, "videos", "used_software_json"))
  ) {
    console.log("[instrumentation] Applying clean software migration 0045");
    await applyMigrationFile(DB, "0045_clean_software.sql");
  }

  if (
    (await tableExists(DB, "event_staff")) &&
    (await columnExists(DB, "event_staff", "permission_mask"))
  ) {
    await backfillPermissionMaskToCustomJson(DB);
    console.log(
      "[instrumentation] Applying clean event staff permissions migration 0046",
    );
    await applyMigrationFile(DB, "0046_clean_event_staff_permissions.sql");
  }

  if (await tableExists(DB, "video_member_chapters")) {
    console.log("[instrumentation] Applying clean member chapters migration 0047");
    await applyMigrationFile(DB, "0047_clean_member_chapters.sql");
  }

  if (!(await tableExists(DB, "legacy_import_batches"))) {
    console.log("[instrumentation] Applying legacy_import_batches migration 0048");
    await applyMigrationFile(DB, "0048_legacy_import_batches.sql");
  }

  if (
    (await tableExists(DB, "user")) &&
    !(await columnExists(DB, "user", "onboarding_completed_at"))
  ) {
    console.log(
      "[instrumentation] Applying user onboarding_completed_at migration 0049",
    );
    await applyMigrationFile(DB, "0049_user_onboarding_completed_at.sql");
  }
}

async function backfillPermissionMaskToCustomJson(
  DB: LocalD1Database,
): Promise<void> {
  const { permissionMaskToKeys } = await import(
    "@/lib/auth/permissions/mask"
  );
  const result = await DB.prepare(
    `SELECT id, permission_mask, permission_preset, custom_permission_keys_json
     FROM event_staff
     WHERE permission_mask IS NOT NULL AND permission_mask <> 0`,
  ).all<{
    id: string;
    permission_mask: number;
    permission_preset: string | null;
    custom_permission_keys_json: string | null;
  }>();
  const rows = result.results ?? [];
  for (const row of rows) {
    const existing = row.custom_permission_keys_json?.trim();
    if (existing && existing !== "[]") continue;
    const keys = permissionMaskToKeys(row.permission_mask);
    if (keys.length === 0) continue;
    await DB.prepare(
      `UPDATE event_staff
       SET custom_permission_keys_json = ?,
           permission_preset = CASE
             WHEN permission_preset = 'public_staff' THEN 'custom'
             ELSE permission_preset
           END
       WHERE id = ?`,
    )
      .bind(JSON.stringify(keys), row.id)
      .run();
  }
}

async function tableExists(
  DB: LocalD1Database,
  tableName: string,
): Promise<boolean> {
  const safeTableName = tableName.replace(/'/g, "''");
  try {
    const existing = await DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${safeTableName}' LIMIT 1`,
    ).first();
    return Boolean(existing);
  } catch {
    return false;
  }
}

async function columnExists(
  DB: LocalD1Database,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  try {
    await DB.prepare(
      `SELECT \`${columnName}\` FROM \`${tableName}\` LIMIT 1`,
    ).first();
    return true;
  } catch {
    return false;
  }
}

async function ensureColumn(
  DB: LocalD1Database,
  tableName: string,
  columnName: string,
  alterSql: string,
): Promise<void> {
  try {
    await DB.prepare(
      `SELECT \`${columnName}\` FROM \`${tableName}\` LIMIT 1`,
    ).first();
    return;
  } catch {
    // Missing columns are repaired below. Other local D1 drift is reported by ALTER.
  }

  try {
    await DB.prepare(alterSql).run();
    console.log(
      `[instrumentation] Added missing local column: ${tableName}.${columnName}`,
    );
  } catch (e) {
    const message = errorMessage(e);
    if (!/duplicate column|already exists/i.test(message)) {
      console.warn(
        `[instrumentation] Failed to add local column ${tableName}.${columnName}:`,
        message,
      );
    }
  }
}

async function ensureIndex(
  DB: LocalD1Database,
  sql: string,
  indexName: string,
): Promise<void> {
  try {
    await DB.prepare(sql).run();
  } catch (e) {
    console.warn(
      `[instrumentation] Failed to ensure local index ${indexName}:`,
      errorMessage(e),
    );
  }
}

async function runOptionalSql(
  DB: LocalD1Database,
  sql: string,
  label: string,
): Promise<void> {
  try {
    await DB.prepare(sql).run();
  } catch (e) {
    console.warn(`[instrumentation] Failed to ${label}:`, errorMessage(e));
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
