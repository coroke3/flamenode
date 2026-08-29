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
