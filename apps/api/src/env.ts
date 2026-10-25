import type { AuditLogSettings } from "@flamenode/server-core/audit/types";
import type { ServerCoreDb } from "@flamenode/server-core/db";
import type { SessionUser, AuthSession } from "./auth/session.ts";

export type Bindings = {
  DB: D1Database;
  BUCKET?: R2Bucket;
  KV?: KVNamespace;
  BUILD_COMMIT_SHA?: string;
  WORKER_ADMIN_TOKEN?: string;
  /** Manage icon signing (MIG-0624); the binding is an owner-approved step tracked in MIG-0628. */
  AUTH_SECRET?: string;
  PUBLIC_VISIBILITY_GUARD_MODE?: string;
  FORCE_STATIC_ONLY?: string;
  YOUTUBE_DAILY_QUOTA_LIMIT?: string;
  /** Configured application origin for write origin verification. */
  NEXT_PUBLIC_SITE_URL?: string;
  /** "1" allows loopback origins (local preview only). */
  FLAMENODE_LOCAL_PREVIEW?: string;
  /** MIG-0605 U02: "1" / "true" / "yes" enables the admin spreadsheet routes (CURRENT ADMIN_SPREADSHEET_ENABLED). */
  ADMIN_SPREADSHEET_ENABLED?: string;
  /** MIG-0605 U02: optional page size (clamped to the S2 row cap). */
  ADMIN_SPREADSHEET_PAGE_SIZE?: string;
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
  auditSettings: AuditLogSettings;
  /** Set once per write request by dbMiddleware (after writeGuard); routes reach server-core only through it. */
  db: ServerCoreDb;
  /** Set by writeGuardMiddleware from its single user read ({ [userId]: json }). */
  actorSnapshotJsonById: Record<string, string>;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};
