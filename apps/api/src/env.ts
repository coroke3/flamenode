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
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};
