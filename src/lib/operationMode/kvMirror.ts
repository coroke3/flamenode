import "server-only";

import { getEnv } from "@/lib/cloudflare";
import {
  OPERATION_MODE_KV_KEY,
  parseOperationModeKvMirror,
  type OperationModeKvMirror,
} from "./kvMirrorCore";

export {
  OPERATION_MODE_KV_KEY,
  parseOperationModeKvMirror,
  type OperationModeKvMirror,
} from "./kvMirrorCore";

export function getOperationModeKv(): KVNamespace | null {
  try {
    return getEnv().KV ?? null;
  } catch {
    return null;
  }
}

export async function readOperationModeKvMirror(): Promise<OperationModeKvMirror | null> {
  const kv = getOperationModeKv();
  if (!kv) return null;
  const raw = await kv.get(OPERATION_MODE_KV_KEY);
  if (typeof raw !== "string") return null;
  return parseOperationModeKvMirror(raw);
}

export async function writeOperationModeKvMirror(
  mirror: OperationModeKvMirror,
): Promise<void> {
  const kv = getOperationModeKv();
  if (!kv) {
    throw new Error("KV binding is unavailable");
  }
  await kv.put(OPERATION_MODE_KV_KEY, JSON.stringify(mirror));
}
