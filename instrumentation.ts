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
  if (process.env.LOCAL_BINDINGS === "0") return;

  const g = globalThis as Record<string | symbol, unknown>;
  if (g.__FLAMENODE_LOCAL_BINDINGS_READY) return;
  g.__FLAMENODE_LOCAL_BINDINGS_READY = true;

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
}

/**
 * Miniflare のローカル D1 にマイグレーションを冪等に当てる。
 * `user` テーブルが既に存在しても、後続 migration の追加列/index は補修する。
 */
type LocalD1Statement = {
  first: () => Promise<unknown>;
  run: () => Promise<unknown>;
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
    const sqlText = fs.readFileSync(path.join(dir, file), "utf8");
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

  // 初期 system_settings
  try {
    await DB.prepare(
      "INSERT OR REPLACE INTO system_settings (id, cost_guard_mode, auto_cost_guard_enabled, is_maintenance_mode, history_retention_days) VALUES ('default', 'normal', 1, 0, 90)",
    ).run();
  } catch {
    /* noop */
  }

  await repairLocalSchemaDrift(DB);
}

async function repairLocalSchemaDrift(DB: LocalD1Database): Promise<void> {
  if (await tableExists(DB, "events")) {
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
      "name_for_sort",
      "ALTER TABLE `video_members` ADD `name_for_sort` text",
    );
    await ensureIndex(
      DB,
      "CREATE INDEX IF NOT EXISTS `video_members_video_name_for_sort_idx` ON `video_members` (`video_id`,`name_for_sort`)",
      "video_members_video_name_for_sort_idx",
    );
    try {
      await DB.prepare(
        "UPDATE `video_members` SET `name_for_sort` = lower(`name`) WHERE `name_for_sort` IS NULL",
      ).run();
    } catch (e) {
      console.warn(
        "[instrumentation] Failed to backfill video_members.name_for_sort:",
        errorMessage(e),
      );
    }
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

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
