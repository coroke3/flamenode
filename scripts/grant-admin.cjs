/**
 * ローカル開発用: Miniflare の D1 永続先（instrumentation と同じ）に対し role=admin を付与する。
 *
 * 使い方:
 *   node scripts/grant-admin.cjs <user の id (UUID)>
 *
 * Next の dev サーバが同じ DB を掴んでいると SQLite ロックで失敗することがあります。
 * その場合は一度 dev を止めてから実行し、再度 dev を起動してください。
 */
const path = require("node:path");
const { Miniflare } = require("miniflare");

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error("Usage: node scripts/grant-admin.cjs <user-id-uuid>");
    process.exit(1);
  }

  const cwd = process.cwd();
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: "flamenode_db" },
    r2Buckets: { BUCKET: "flamenode-storage" },
    kvNamespaces: { KV: "FLAMENODE_KV" },
    d1Persist: path.join(cwd, ".wrangler/state/v3/d1"),
    r2Persist: path.join(cwd, ".wrangler/state/v3/r2"),
    kvPersist: path.join(cwd, ".wrangler/state/v3/kv"),
  });

  try {
    const db = await mf.getD1Database("DB");
    const before = await db
      .prepare("SELECT id, name, role FROM user WHERE id = ?")
      .bind(userId)
      .first();
    if (!before) {
      console.error("該当 id の user 行がありません:", userId);
      console.error(
        "別のローカル DB を見ている可能性があります。一度 Discord でログインして user 行を作成してから再実行してください。",
      );
      process.exit(1);
    }
    await db
      .prepare("UPDATE user SET role = 'admin' WHERE id = ?")
      .bind(userId)
      .run();
    const after = await db
      .prepare("SELECT id, name, role FROM user WHERE id = ?")
      .bind(userId)
      .first();
    console.log("OK:", after);
    console.log("ブラウザでログアウト→再ログイン後、/admin を開いてください。");
  } finally {
    await mf.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
