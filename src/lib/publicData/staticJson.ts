import "server-only";
import { getEnv } from "@/lib/cloudflare";

export async function readStaticJson<T>(key: string): Promise<T | null> {
  try {
    const bucket = getEnv().BUCKET;
    if (!bucket) return null;
    const object = await bucket.get(key);
    if (!object) return null;
    return (await object.json()) as T;
  } catch {
    return null;
  }
}
