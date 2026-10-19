import { z } from "zod";

export const PublicHealthResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    service: z.literal("flamenode-web"),
    commit: z.string(),
    runtime: z.literal("cloudflare-worker"),
  }),
  z.object({
    ok: z.literal(false),
    service: z.literal("flamenode-web"),
    runtime: z.literal("cloudflare-worker"),
  }),
]);

export type PublicHealthResponse = z.infer<typeof PublicHealthResponseSchema>;

export const DeepHealthStatusSchema = z.enum(["ok", "degraded"]);

export const DeepHealthChecksSchema = z.object({
  d1: DeepHealthStatusSchema,
  kv: DeepHealthStatusSchema,
  r2: DeepHealthStatusSchema,
  schema: DeepHealthStatusSchema,
  queues: DeepHealthStatusSchema,
  static_artifacts: DeepHealthStatusSchema,
  public_visibility: DeepHealthStatusSchema,
});

export const PublicVisibilityGuardModeSchema = z.enum(["off", "observe", "enforce"]);
export type PublicVisibilityGuardMode = z.infer<typeof PublicVisibilityGuardModeSchema>;

export const DeepHealthResultSchema = z.object({
  ok: z.boolean(),
  status: DeepHealthStatusSchema,
  service: z.literal("flamenode-web"),
  commit: z.string(),
  checks: DeepHealthChecksSchema,
  public_visibility_guard_mode: PublicVisibilityGuardModeSchema.optional(),
  public_visibility_stuck_fence_candidates: z.number().optional(),
});

export type DeepHealthResult = z.infer<typeof DeepHealthResultSchema>;
