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
};

export type Variables = {
  user: SessionUser | null;
  session: AuthSession | null;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};
