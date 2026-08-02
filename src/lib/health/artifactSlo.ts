/**
 * Global public artifact SLO probes (docs/operations/static-delivery.md §主な公開 artifact).
 * Deep health and check:artifact-slo share this contract.
 */

import {
  normalizePublicVisibilityBlockedEntitiesManifest,
  PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
} from "../publicData/publicVisibilityManifestCore.ts";

export const STATIC_ARTIFACT_SLO_MAX_AGE_SEC = 90 * 24 * 3600;
export const TOP_NOSTALGIC_SHUFFLE_SLO_MAX_AGE_SEC = 2 * 24 * 3600;

export type ArtifactSloProbe = {
  key: string;
  requiredKeys: string[];
  maxAgeSec?: number;
};

/** Requirement 14.2 global artifact inventory. */
export const ARTIFACT_SLO_PROBES: readonly ArtifactSloProbe[] = Object.freeze([
  {
    key: "top.json",
    requiredKeys: [
      "generated_at",
      "latest",
      "nostalgic_pool",
      "nostalgic",
      "nostalgic_shuffled_at",
      "stats",
    ],
  },
  {
    key: "list/recent.json",
    requiredKeys: ["generated_at", "total", "items"],
  },
  {
    key: "list/popular.json",
    requiredKeys: ["generated_at", "total", "items"],
  },
  {
    key: "search-index-lite.json",
    requiredKeys: ["generated_at", "videos", "users"],
  },
  {
    key: "events/index.json",
    requiredKeys: ["generated_at", "items", "group_sections"],
  },
  {
    key: "users/index.json",
    requiredKeys: ["generated_at", "items"],
  },
  {
    key: "recommend.json",
    requiredKeys: ["generated_at", "recommended", "latest", "underrated", "creators"],
  },
  {
    key: "rules/current.json",
    requiredKeys: ["generated_at", "version_label", "body_markdown"],
  },
  {
    key: PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
    requiredKeys: ["schema_version", "revision", "generated_at", "entities"],
  },
]);

function parseGeneratedAt(value: unknown, label: string): number {
  const generatedAt = Number(value);
  if (!Number.isFinite(generatedAt) || generatedAt <= 0) {
    throw new Error(`${label}: invalid generated_at`);
  }
  return generatedAt;
}

function assertArrayField(
  payload: Record<string, unknown>,
  key: string,
  label: string,
): void {
  if (!Array.isArray(payload[key])) {
    throw new Error(`${label}: ${key} must be an array`);
  }
}

function assertArtifactShape(
  probe: ArtifactSloProbe,
  payload: Record<string, unknown>,
  nowSec: number,
): void {
  const maxAgeSec = probe.maxAgeSec ?? STATIC_ARTIFACT_SLO_MAX_AGE_SEC;
  const generatedAt = parseGeneratedAt(payload.generated_at, probe.key);
  if (generatedAt > nowSec + 60) {
    throw new Error(`${probe.key}: generated_at is in the future`);
  }
  if (nowSec - generatedAt > maxAgeSec) {
    throw new Error(`${probe.key}: generated_at is stale`);
  }

  if (probe.key === "top.json") {
    assertArrayField(payload, "latest", probe.key);
    assertArrayField(payload, "nostalgic_pool", probe.key);
    assertArrayField(payload, "nostalgic", probe.key);
    const shuffledAt = parseGeneratedAt(
      payload.nostalgic_shuffled_at,
      "top.json nostalgic_shuffled_at",
    );
    if (shuffledAt > nowSec + 60) {
      throw new Error("top.json: nostalgic_shuffled_at is in the future");
    }
    if (nowSec - shuffledAt > TOP_NOSTALGIC_SHUFFLE_SLO_MAX_AGE_SEC) {
      throw new Error("top.json: nostalgic_shuffled_at is stale");
    }
    if (!payload.stats || typeof payload.stats !== "object") {
      throw new Error("top.json: stats must be an object");
    }
    return;
  }

  if (probe.key === "list/recent.json" || probe.key === "list/popular.json") {
    assertArrayField(payload, "items", probe.key);
    const total = Number(payload.total);
    if (!Number.isFinite(total) || total < 0) {
      throw new Error(`${probe.key}: invalid total`);
    }
    const items = payload.items;
    if (Array.isArray(items) && items.length > total) {
      throw new Error(`${probe.key}: items length exceeds total`);
    }
    return;
  }

  if (probe.key === "search-index-lite.json") {
    assertArrayField(payload, "videos", probe.key);
    assertArrayField(payload, "users", probe.key);
    return;
  }

  if (probe.key === "events/index.json") {
    assertArrayField(payload, "items", probe.key);
    assertArrayField(payload, "group_sections", probe.key);
    return;
  }

  if (probe.key === "users/index.json") {
    assertArrayField(payload, "items", probe.key);
    return;
  }

  if (probe.key === "recommend.json") {
    assertArrayField(payload, "recommended", probe.key);
    assertArrayField(payload, "latest", probe.key);
    assertArrayField(payload, "underrated", probe.key);
    assertArrayField(payload, "creators", probe.key);
    return;
  }

  if (probe.key === PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY) {
    const normalized = normalizePublicVisibilityBlockedEntitiesManifest(payload);
    if (!normalized) {
      throw new Error(`${probe.key}: malformed visibility manifest`);
    }
  }
}

export async function assertArtifactSloFresh(
  bucket: { get: (key: string) => Promise<{ text: () => Promise<string> } | null> },
  nowSec: number,
  probes: readonly ArtifactSloProbe[] = ARTIFACT_SLO_PROBES,
): Promise<void> {
  for (const probe of probes) {
    const object = await bucket.get(probe.key);
    if (!object) {
      throw new Error(`static artifact missing: ${probe.key}`);
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(await object.text()) as Record<string, unknown>;
    } catch {
      throw new Error(`static artifact malformed: ${probe.key}`);
    }
    for (const key of probe.requiredKeys) {
      if (!(key in payload)) {
        throw new Error(`${probe.key}: missing required field ${key}`);
      }
    }
    assertArtifactShape(probe, payload, nowSec);
  }
}

export function listArtifactSloKeys(): string[] {
  return ARTIFACT_SLO_PROBES.map((probe) => probe.key);
}
