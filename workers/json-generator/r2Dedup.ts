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

function meaningfulJsonBody(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const { generated_at: _generatedAt, ...meaningful } = parsed as Record<
        string,
        unknown
      >;
      return JSON.stringify(meaningful);
    }
  } catch {
    // JSONでない文字列はbytes相当の元文字列をhash対象にする。
  }
  return value;
}

/** 最上位generated_atだけを除外し、公開内容が同一なら同じhashを返す。 */
export async function staticArtifactContentHash(value: string): Promise<string> {
  return sha256Hex(meaningfulJsonBody(value));
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
            const nextHash = await staticArtifactContentHash(value);
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
