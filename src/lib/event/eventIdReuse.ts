import "server-only";

import type { DB } from "@/lib/db/client";
import { getEnv } from "@/lib/cloudflare";
import {
  readPublicVisibilityBlockedEntitiesManifest,
  writePublicVisibilityBlockedEntitiesManifest,
} from "@/lib/publicData/publicVisibilityManifest";
import {
  preCommitEventIdReuse as preCommitEventIdReuseCore,
  compensateEventIdReuseOnD1Failure as compensateEventIdReuseCore,
  type EventIdReuseHost,
  type EventIdReuseTombstone,
  type EventIdReusePrecommit,
  type EventIdReusePreparation,
} from "@flamenode/server-core/visibility/eventIdReuse";

export type {
  EventIdReuseTombstone,
  EventIdReusePrecommit,
  EventIdReusePreparation,
} from "@flamenode/server-core/visibility/eventIdReuse";
export { eventIdRenameCleanupTargets } from "./eventIdReuseCore";

// Keep the CURRENT wrappers, including their missing-bucket policy. Resolving
// getEnv here eagerly would change validation order and compensation behavior.
const nextEventIdReuseHost: EventIdReuseHost = {
  requireBucket: () => getEnv().BUCKET,
  readManifest: readPublicVisibilityBlockedEntitiesManifest,
  writeManifest: writePublicVisibilityBlockedEntitiesManifest,
};

/** CURRENT public signature; only the host-free implementation moved. */
export async function preCommitEventIdReuse(input: {
  db: DB;
  eventId: string;
  tombstone: EventIdReuseTombstone;
  now?: number;
}): Promise<EventIdReusePreparation> {
  return preCommitEventIdReuseCore(input, nextEventIdReuseHost);
}

export async function compensateEventIdReuseOnD1Failure(
  input: EventIdReusePrecommit,
): Promise<void> {
  return compensateEventIdReuseCore(input, nextEventIdReuseHost);
}
