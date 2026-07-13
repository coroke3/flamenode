type DedupEnv = {
  DB: D1Database;
  R2: R2Bucket;
};

type R2PutArgs = Parameters<R2Bucket["put"]>;
type R2PutResult = Awaited<ReturnType<R2Bucket["put"]>>;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function currentArtifactHash(
  db: D1Database,
  objectKey: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT content_hash
       FROM static_artifacts
       WHERE object_key = ? AND deleted_at IS NULL
       ORDER BY generated_at DESC
       LIMIT 1`,
    )
    .bind(objectKey)
    .first<{ content_hash?: string }>();
  return row?.content_hash ?? null;
}

/**
 * JSON generatorが渡すstring bodyだけを対象に、同一hashのR2 PUTを省略する。
 * DBにhashが残っていてもR2実体が欠落している場合は通常PUTへフォールバックする。
 */
export function withDeduplicatingR2<Env extends DedupEnv>(env: Env): Env {
  const bucket = env.R2;
  const wrapped = new Proxy(bucket, {
    get(target, property, receiver) {
      if (property === "put") {
        return async (...args: R2PutArgs): Promise<R2PutResult> => {
          const [key, value] = args;
          if (typeof value === "string") {
            const nextHash = await sha256Hex(value);
            const storedHash = await currentArtifactHash(env.DB, key);
            if (storedHash === nextHash) {
              const existing = await bucket.head(key);
              if (existing) return existing;
            }
          }
          return bucket.put(...args);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as R2Bucket;
  return { ...env, R2: wrapped };
}
