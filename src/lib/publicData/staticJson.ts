import "server-only";
import { getDatabase, getEnv } from "@/lib/cloudflare";
import { getOperationMode } from "@/lib/operationMode/getMode";
import { getPublicDataStrategy } from "@/lib/operationMode/policy";

export async function shouldUseStaticJsonOnly(): Promise<boolean> {
  const db = getDatabase();
  if (!db) return false;
  const mode = await getOperationMode(db);
  return getPublicDataStrategy(mode) === "static_json_only";
}

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

export async function readStaticJsonIfStaticOnly<T>(
  key: string,
): Promise<T | null> {
  if (!(await shouldUseStaticJsonOnly())) return null;
  return readStaticJson<T>(key);
}
