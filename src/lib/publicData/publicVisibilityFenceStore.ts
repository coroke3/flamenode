// Compatibility bridge (MIG-0614, D-10): implementation lives in packages/server-core; remove when callers import it directly.
import "server-only";

export * from "@flamenode/server-core/visibility/fenceStore";
