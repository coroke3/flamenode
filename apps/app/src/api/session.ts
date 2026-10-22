/**
 * Session read contract for the Personal SPA (MIG-0701).
 *
 * BLOCKER: apps/api has no route that exposes the resolved session
 * (MIG-0608 added only the middleware). `PersonalApi` is the seam a later
 * Hono read endpoint plugs into; nothing here invents server behavior.
 */
export interface PersonalSessionUser {
  id: string;
  name: string | null;
  role: "user" | "admin" | "moderator";
  is_banned: 0 | 1;
  active_x_user_id: string | null;
}

export type SessionResult =
  | { status: "ok"; user: PersonalSessionUser }
  | { status: "anonymous" }
  | { status: "unavailable" };

export type SessionState = { status: "loading" } | SessionResult;

export interface PersonalApi {
  getSession(signal?: AbortSignal): Promise<SessionResult>;
}

/** Default until a Hono session read endpoint exists. */
export const unwiredPersonalApi: PersonalApi = {
  getSession: () => Promise.resolve({ status: "unavailable" }),
};
