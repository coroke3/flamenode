import type { SessionUser, AuthSession } from "./auth/session.ts";

export type Bindings = {
  DB: D1Database;
  BUCKET?: R2Bucket;
  KV?: KVNamespace;
  BUILD_COMMIT_SHA?: string;
  WORKER_ADMIN_TOKEN?: string;
  PUBLIC_VISIBILITY_GUARD_MODE?: string;
  /** Configured application origin for write origin verification. */
  NEXT_PUBLIC_SITE_URL?: string;
  /** "1" allows loopback origins (local preview only). */
  FLAMENODE_LOCAL_PREVIEW?: string;
};

export type Variables = {
  user: SessionUser | null;
  session: AuthSession | null;
  sessionState: "none" | "unavailable" | "user";
  /** True when writeGuardMiddleware({ activeX }) already evaluated CostGuard. */
  costGuardEvaluated: boolean;
  /** Active X and approved X IDs read in the same user query. */
  activeX: { activeXId: string | null; approvedXIds: string[] };
  /** Set by costGuardMiddleware from its single system_settings read. */
  auditSettings: import("./audit/mutateWithAudit.ts").AuditLogSettings;
  /** Set by writeGuardMiddleware from its single user read ({ [userId]: json }). */
  actorSnapshotJsonById: Record<string, string>;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};
