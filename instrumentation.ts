/**
 * 開発時だけMiniflareのD1/R2/KV bindingを提供する。
 *
 * DBの作成・ALTER・backfillはここでは絶対に行わない。ローカルDBは
 * `npm run db:local-apply` でactive baselineを適用してから起動し、
 * schema metaが一致しない場合は明示的に停止する。
 */

const ACTIVE_SCHEMA_VERSION = "2026-07-11-baseline-1";

type LocalD1Statement = {
  first: <T = unknown>() => Promise<T | null>;
};

type LocalD1Database = {
  prepare: (query: string) => LocalD1Statement;
};

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
      `ローカルD1のschemaを確認できません: ${detail}。npm run db:local-apply を実行してactive baselineを適用してください。`,
    );
  }
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.LOCAL_BINDINGS === "0") return;
  if (
    process.argv.some((arg) => arg.includes("build")) ||
    process.env.npm_lifecycle_event === "build"
  ) {
    return;
  }

  const globals = globalThis as Record<string | symbol, unknown>;
  if (globals.__FLAMENODE_LOCAL_BINDINGS_PROMISE) {
    await (globals.__FLAMENODE_LOCAL_BINDINGS_PROMISE as Promise<void>);
    return;
  }

  const init = (async () => {
    // Next の instrumentation は Edge 向けにも解析される。Miniflare はローカル Node
    // 開発時だけ必要な Node 依存なので、production/Edge bundle に取り込ませない。
    // `webpackIgnore` により Node runtime が development register 時だけ解決する。
    const { getPlatformProxy } = await import(
      /* webpackIgnore: true */ "wrangler"
    );
    const platform = await getPlatformProxy<{
      DB: D1Database;
      BUCKET: R2Bucket;
      KV: KVNamespace;
    }>({
      configPath: "wrangler.toml",
      persist: { path: ".wrangler/state/v3" },
      remoteBindings: false,
      envFiles: [],
    });

    try {
      const { DB, BUCKET, KV } = platform.env;
      await assertLocalSchemaVersion(DB);
      globals.__FLAMENODE_LOCAL_BINDINGS = { DB, BUCKET, KV };
      globals.__FLAMENODE_LOCAL_PLATFORM = platform;
    } catch (error) {
      await platform.dispose();
      throw error;
    }
  })();

  globals.__FLAMENODE_LOCAL_BINDINGS_PROMISE = init;
  try {
    await init;
  } catch (error) {
    globals.__FLAMENODE_LOCAL_BINDINGS_PROMISE = undefined;
    throw error;
  }
}
