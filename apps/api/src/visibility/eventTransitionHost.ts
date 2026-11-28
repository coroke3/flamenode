/**
 * MIG-0652 U02 — Hono Event visibility-fence host (not a mounted route).
 * CURRENT: src/lib/publicData/visibilityManifestHost.ts.
 *
 * The R2 binding belongs to the request, never to ambient getEnv().
 * Every event transition precommit and compensation operation in server-core
 * receives this same host. Missing R2 cannot turn a private/renamed event
 * public by silently skipping the manifest fence.
 */
import type { Bindings } from "../env.ts";
import type { VisibilityFenceHost } from "@flamenode/server-core/visibility/manifestHost";
import {
  readVisibilityManifestObject,
  putVisibilityManifestWithCas,
} from "@flamenode/server-core/visibility/manifestR2";

export const EVENT_VISIBILITY_MANIFEST_MISSING_BUCKET =
  "public_visibility_manifest_bucket_missing";

/** The transition host is built per request; do not cache it across Workers. */
export function createEventVisibilityFenceHost(
  env: Pick<Bindings, "BUCKET">,
): VisibilityFenceHost {
  function requireBucket(): R2Bucket {
    if (!env.BUCKET) throw new Error(EVENT_VISIBILITY_MANIFEST_MISSING_BUCKET);
    return env.BUCKET;
  }
  return {
    manifest: {
      // Unlike a public read in observe mode, a mutation must always fail
      // closed when R2 is unavailable: it cannot safely commit D1 first.
      read: () => readVisibilityManifestObject(requireBucket()),
      write: (manifest, options) => {
        // All event precommit/rollback paths use read + ETag CAS. Never
        // permit an unconditional PUT to clobber another operator's fence.
        if (!options || !Object.prototype.hasOwnProperty.call(options, "ifMatchEtag")) {
          throw new Error("public_visibility_manifest_cas_required");
        }
        return putVisibilityManifestWithCas(
          requireBucket(),
          manifest,
          options.ifMatchEtag ?? null,
          options.mutateOnConflict,
        );
      },
    },
  };
}
