import { getCloudflareContext } from "@opennextjs/cloudflare";

const ACTIVE_SCHEMA_VERSION = "2026-08-24-observability-1";

type LocalD1Statement = {
  first: <T = unknown>() => Promise<T | null>;
};

type LocalD1Database = {
  prepare: (query: string) => LocalD1Statement;
};

function isD1Database(value: unknown): value is LocalD1Database {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { prepare?: unknown }).prepare === "function"
  );
}

async function assertLocalSchemaVersion(db: LocalD1Database): Promise<void> {
  try {
    const row = await db
      .prepare(
        "SELECT version FROM flamenode_schema_meta WHERE id = 'current' LIMIT 1",
      )
      .first<{ version?: string }>();
    if (row?.version === ACTIVE_SCHEMA_VERSION) return;
    throw new Error(
      `local D1 schema version mismatch (expected ${ACTIVE_SCHEMA_VERSION}, got ${row?.version ?? "missing"})`,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new Error(
      `ローカルD1のschemaを確認できません: ${detail}。npm run db:local-apply でactive migrationを適用してください。`,
    );
  }
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "development") return;
  if (process.env.LOCAL_BINDINGS === "0") return;

  const { env } = await getCloudflareContext({ async: true });
  if (!isD1Database(env.DB)) {
    throw new Error("ローカルD1 binding 'DB' がありません。wrangler.tomlを確認してください。");
  }
  await assertLocalSchemaVersion(env.DB);
}
