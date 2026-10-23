import { Hono } from "hono";
import type { PersonalSessionResponse } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { loadPersonalContext } from "./context.ts";

// CURRENT: src/lib/auth/guard.tsx requireSession() -> AuthSessionUser.
// D1: 1 batch (terms row + linked X rows), after the session lookup of sessionMiddleware.
export const personalSessionRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) return c.json({ error: "Unauthorized" }, 401);
  const ctx = await loadPersonalContext(c.env.DB, sessionUser, { pendingRequest: false });
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const body: PersonalSessionResponse = { user: ctx.user };
  return c.json(body);
});
