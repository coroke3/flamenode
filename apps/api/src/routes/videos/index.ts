/** MIG-0603: /api/videos router (U01 RH-030 detail; RH-031/032 pending, see work item). */
import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import { videoDetailRoutes } from "./detail.ts";

export const videosRoutes = new Hono<AppEnv>();
videosRoutes.route("/", videoDetailRoutes);
