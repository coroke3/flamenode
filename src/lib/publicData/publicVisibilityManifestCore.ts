export const PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY =
  "visibility/blocked-entities.v1.json";

export const PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES = 1024 * 1024;

export const PUBLIC_VISIBILITY_MANIFEST_SCHEMA_VERSION = 1;

export type PublicVisibilityFenceEntityType =
  | "video"
  | "event"
  | "x_user"
  | "event_group";

export type PublicVisibilityFenceState =
  | "blocked"
  | "release_pending"
  | "released";

export type PublicVisibilityGuardMode = "off" | "observe" | "enforce";

export type PublicVisibilityBlockedEntity = {
  entity_type: PublicVisibilityFenceEntityType;
  entity_id: string;
  fence_token: string;
  blocked_at: number;
  reason?: string | null;
};

export type PublicVisibilityBlockedEntitiesManifest = {
  schema_version: number;
  revision: number;
  generated_at: number;
  entities: PublicVisibilityBlockedEntity[];
};

export function resolvePublicVisibilityGuardMode(
  value: string | undefined | null,
): PublicVisibilityGuardMode {
  if (value === "off" || value === "enforce") return value;
  return "observe";
}

export function normalizePublicVisibilityBlockedEntitiesManifest(
  value: unknown,
): PublicVisibilityBlockedEntitiesManifest | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<PublicVisibilityBlockedEntitiesManifest>;
  if (
    typeof row.schema_version !== "number" ||
    typeof row.revision !== "number" ||
    typeof row.generated_at !== "number" ||
    !Array.isArray(row.entities)
  ) {
    return null;
  }
  const entities: PublicVisibilityBlockedEntity[] = [];
  for (const entry of row.entities) {
    if (!entry || typeof entry !== "object") return null;
    const entity = entry as Partial<PublicVisibilityBlockedEntity>;
    if (
      (entity.entity_type !== "video" &&
        entity.entity_type !== "event" &&
        entity.entity_type !== "x_user" &&
        entity.entity_type !== "event_group") ||
      typeof entity.entity_id !== "string" ||
      typeof entity.fence_token !== "string" ||
      typeof entity.blocked_at !== "number"
    ) {
      return null;
    }
    entities.push({
      entity_type: entity.entity_type,
      entity_id: entity.entity_id,
      fence_token: entity.fence_token,
      blocked_at: entity.blocked_at,
      reason: entity.reason ?? null,
    });
  }
  return {
    schema_version: row.schema_version,
    revision: row.revision,
    generated_at: row.generated_at,
    entities,
  };
}

export function isEntityBlockedInManifest(
  manifest: PublicVisibilityBlockedEntitiesManifest,
  entityType: PublicVisibilityFenceEntityType,
  entityId: string,
): boolean {
  const normalizedId =
    entityType === "x_user" ? entityId.toLowerCase() : entityId;
  return manifest.entities.some((entry) => {
    const entryId =
      entry.entity_type === "x_user"
        ? entry.entity_id.toLowerCase()
        : entry.entity_id;
    return entry.entity_type === entityType && entryId === normalizedId;
  });
}

export function upsertBlockedEntityInManifest(
  manifest: PublicVisibilityBlockedEntitiesManifest,
  entry: PublicVisibilityBlockedEntity,
  nowSec: number,
): PublicVisibilityBlockedEntitiesManifest {
  const normalizedId =
    entry.entity_type === "x_user"
      ? entry.entity_id.toLowerCase()
      : entry.entity_id;
  const entities = manifest.entities.filter((row) => {
    const rowId =
      row.entity_type === "x_user"
        ? row.entity_id.toLowerCase()
        : row.entity_id;
    return !(
      row.entity_type === entry.entity_type && rowId === normalizedId
    );
  });
  entities.push({
    ...entry,
    entity_id: normalizedId,
  });
  return {
    schema_version: PUBLIC_VISIBILITY_MANIFEST_SCHEMA_VERSION,
    revision: manifest.revision + 1,
    generated_at: nowSec,
    entities,
  };
}

export function releaseBlockedEntityInManifest(
  manifest: PublicVisibilityBlockedEntitiesManifest,
  entityType: PublicVisibilityFenceEntityType,
  entityId: string,
  fenceToken: string,
  nowSec: number,
): PublicVisibilityBlockedEntitiesManifest | null {
  const normalizedId =
    entityType === "x_user" ? entityId.toLowerCase() : entityId;
  const current = manifest.entities.find((entry) => {
    const entryId =
      entry.entity_type === "x_user"
        ? entry.entity_id.toLowerCase()
        : entry.entity_id;
    return entry.entity_type === entityType && entryId === normalizedId;
  });
  if (!current || current.fence_token !== fenceToken) {
    return null;
  }
  const entities = manifest.entities.filter((entry) => {
    const entryId =
      entry.entity_type === "x_user"
        ? entry.entity_id.toLowerCase()
        : entry.entity_id;
    return !(
      entry.entity_type === entityType && entryId === normalizedId
    );
  });
  return {
    schema_version: PUBLIC_VISIBILITY_MANIFEST_SCHEMA_VERSION,
    revision: manifest.revision + 1,
    generated_at: nowSec,
    entities,
  };
}

export function emptyPublicVisibilityBlockedEntitiesManifest(
  nowSec: number,
): PublicVisibilityBlockedEntitiesManifest {
  return {
    schema_version: PUBLIC_VISIBILITY_MANIFEST_SCHEMA_VERSION,
    revision: 0,
    generated_at: nowSec,
    entities: [],
  };
}
