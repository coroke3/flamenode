import "server-only";
import { getEnv } from "@/lib/cloudflare";

export async function readStaticJson<T>(key: string): Promise<T | null> {
  const bucket = getEnv().BUCKET;
  if (!bucket) return null;
  const object = await bucket.get(key);
  if (!object) return null;
  try {
    return (await object.json()) as T;
  } catch {
    return null;
  }
}
