import "server-only";

import { getEnv } from "@/lib/cloudflare";
import type { DB } from "@/lib/db/client";
import { tryDeleteUnreferencedIcon } from "@/lib/media/iconOrphanCleanup";

export async function cleanupReplacedVideoCreatorIcon(
  db: DB,
  previousIconUrl: string | null | undefined,
  nextIconUrl: string | null | undefined,
): Promise<void> {
  const env = getEnv();
  if (!env.BUCKET) return;
  await tryDeleteUnreferencedIcon(db.$client, env.BUCKET, previousIconUrl, nextIconUrl);
}
