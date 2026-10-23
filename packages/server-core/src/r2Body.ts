export type CancellableR2Body = {
  body?: unknown;
};

/**
 * R2 GET の response body を呼び出し側が返さない経路で明示的に解放する。
 * Cloudflare runtime では未消費 body が同一 invocation の接続資源を保持し得るため、
 * oversized / unsafe / 304 / existence-only の早期 return 前に best-effort で呼ぶ。
 */
export async function cancelR2BodyBestEffort(
  object: CancellableR2Body | null | undefined,
): Promise<void> {
  const body = object?.body;
  if (!body || typeof body !== "object") return;
  const cancel = (body as { cancel?: unknown }).cancel;
  if (typeof cancel !== "function") return;
  try {
    await Reflect.apply(cancel, body, []);
  } catch {
    // Resource cleanup only. The caller's original result must win.
  }
}

export type BoundedR2JsonObject = CancellableR2Body & {
  size?: number;
  json(): Promise<unknown>;
};

export type BoundedR2JsonResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "missing" | "too_large" }
  | { ok: false; reason: "invalid_json"; error: unknown };

type BoundedR2JsonBucket = {
  get(key: string): Promise<BoundedR2JsonObject | null>;
};

/**
 * 上限付きで R2 の JSON object を読む。size が分かる object は body を読む前に
 * 上限を確かめ、超過時は body を解放してから返す。上限が不正なら読まない
 * （fail closed）。GET 自体の失敗は呼び出し側へ投げる。
 *
 * signal を渡すと、GET 中に abort されたとき body を解放して `aborted` を返す。
 * 呼び出し側は直後に自分の abort 判定で投げる（エラーの種類を呼び出し側に残す）。
 */
export function readBoundedR2Json(
  bucket: BoundedR2JsonBucket,
  key: string,
  maxBytes: number,
): Promise<BoundedR2JsonResult>;
export function readBoundedR2Json(
  bucket: BoundedR2JsonBucket,
  key: string,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<BoundedR2JsonResult | { ok: false; reason: "aborted" }>;
export async function readBoundedR2Json(
  bucket: BoundedR2JsonBucket,
  key: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<BoundedR2JsonResult | { ok: false; reason: "aborted" }> {
  const object = await bucket.get(key);
  if (signal?.aborted) {
    await cancelR2BodyBestEffort(object);
    return { ok: false, reason: "aborted" };
  }
  if (!object) return { ok: false, reason: "missing" };
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    (typeof object.size === "number" &&
      (!Number.isSafeInteger(object.size) ||
        object.size < 0 ||
        object.size > maxBytes))
  ) {
    await cancelR2BodyBestEffort(object);
    return { ok: false, reason: "too_large" };
  }
  try {
    return { ok: true, value: await object.json() };
  } catch (error) {
    return { ok: false, reason: "invalid_json", error };
  }
}
