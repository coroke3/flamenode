/**
 * Build-only snapshot projection PoC (MIG-0401).
 * This is NOT a request handler or a replacement for the request-time visibility gateway.
 * Runtime reads are injected so Astro builds can use local fixtures or a read-only R2 client.
 */
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

export type SnapshotKind = "video" | "user" | "event";

export interface BasePublicSnapshot {
  readonly kind: SnapshotKind;
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly canonicalUrl?: string;
  readonly ogImageUrl?: string;
  readonly aliasOf?: string;
}

export interface VideoPublicSnapshot extends BasePublicSnapshot {
  readonly kind: "video";
  readonly creatorName?: string;
  readonly creatorHandle?: string;
  readonly creatorAvatarUrl?: string;
  readonly thumbnailUrl?: string;
  readonly publishedAt?: string;
  readonly youtubeVideoId?: string;
}

export interface UserPublicSnapshot extends BasePublicSnapshot {
  readonly kind: "user";
  readonly name?: string;
  readonly handle?: string;
  readonly bio?: string;
  readonly avatarUrl?: string;
}

export interface EventPublicSnapshot extends BasePublicSnapshot {
  readonly kind: "event";
  readonly bannerUrl?: string;
  readonly iconUrl?: string;
  readonly status?: string;
  readonly periodText?: string;
}

export type PublicSnapshot =
  | VideoPublicSnapshot
  | UserPublicSnapshot
  | EventPublicSnapshot
  | BasePublicSnapshot;

export type SnapshotSource = Readonly<{
  read(key: string): Promise<Uint8Array | null>;
}>;
export type SnapshotManifest = Readonly<{
  schemaVersion: 1;
  generation: string;
  allowedKeys: readonly string[];
  blockedKeys: readonly string[];
}>;
export type SnapshotBuildMetrics = {
  reads: number;
  bytes: number;
  parseMs: number;
  accepted: number;
  rejected: number;
};
export type SnapshotLoadOptions = Readonly<{
  manifest: SnapshotManifest | null;
  generation: string;
  maxBytes?: number;
  metrics?: SnapshotBuildMetrics;
}>;
type SnapshotEnvelope = {
  schemaVersion: number;
  generation: string;
  key: string;
  visibility: string;
  sha256: string;
  payload: unknown;
};

const MAX_OBJECT_BYTES = 2 * 1024 * 1024;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const HEX_256 = /^[a-f0-9]{64}$/;
const decode = new TextDecoder("utf-8", { fatal: true });

export class SnapshotBuildError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SnapshotBuildError";
  }
}

export function newSnapshotBuildMetrics(): SnapshotBuildMetrics {
  return { reads: 0, bytes: 0, parseMs: 0, accepted: 0, rejected: 0 };
}

function reject(metrics: SnapshotBuildMetrics, code: string, message: string): never {
  metrics.rejected += 1;
  throw new SnapshotBuildError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  return /^https?:\/\/[^\s<>"']+$/i.test(trimmed) || (/^\/[^\/\s<>"']+/i.test(trimmed) && !trimmed.startsWith("//"));
}

function validatedPublicDto(value: unknown): PublicSnapshot | null {
  if (!isRecord(value)) return null;
  const { kind, id, title } = value;
  if (
    !["video", "user", "event"].includes(String(kind)) ||
    typeof id !== "string" || !ID_PATTERN.test(id) ||
    typeof title !== "string" || title.length === 0 || title.length > 300
  ) return null;

  const base: Record<string, unknown> = {
    kind: kind as SnapshotKind,
    id,
    title,
  };

  if (typeof value.description === "string") base.description = value.description.slice(0, 5000);
  if (isSafeUrl(value.canonicalUrl)) base.canonicalUrl = value.canonicalUrl.trim();
  if (isSafeUrl(value.ogImageUrl)) base.ogImageUrl = value.ogImageUrl.trim();
  if (typeof value.aliasOf === "string" && ID_PATTERN.test(value.aliasOf)) base.aliasOf = value.aliasOf;

  if (kind === "video") {
    if (typeof value.creatorName === "string") base.creatorName = value.creatorName.slice(0, 100);
    if (typeof value.creatorHandle === "string") base.creatorHandle = value.creatorHandle.slice(0, 100);
    if (isSafeUrl(value.creatorAvatarUrl)) base.creatorAvatarUrl = value.creatorAvatarUrl.trim();
    if (isSafeUrl(value.thumbnailUrl)) base.thumbnailUrl = value.thumbnailUrl.trim();
    if (typeof value.publishedAt === "string") base.publishedAt = value.publishedAt.slice(0, 50);
    if (typeof value.youtubeVideoId === "string" && /^[a-zA-Z0-9_-]{6,15}$/.test(value.youtubeVideoId)) {
      base.youtubeVideoId = value.youtubeVideoId;
    }
  } else if (kind === "user") {
    if (typeof value.name === "string") base.name = value.name.slice(0, 100);
    if (typeof value.handle === "string") base.handle = value.handle.slice(0, 100);
    if (typeof value.bio === "string") base.bio = value.bio.slice(0, 2000);
    if (isSafeUrl(value.avatarUrl)) base.avatarUrl = value.avatarUrl.trim();
  } else if (kind === "event") {
    if (isSafeUrl(value.bannerUrl)) base.bannerUrl = value.bannerUrl.trim();
    if (isSafeUrl(value.iconUrl)) base.iconUrl = value.iconUrl.trim();
    if (typeof value.status === "string") base.status = value.status.slice(0, 50);
    if (typeof value.periodText === "string") base.periodText = value.periodText.slice(0, 200);
  }

  // Strict projection. Never forward unknown metadata or private attributes.
  return base as unknown as PublicSnapshot;
}

function checkedManifest(manifest: SnapshotManifest | null, generation: string, metrics: SnapshotBuildMetrics): SnapshotManifest {
  if (!manifest || manifest.schemaVersion !== 1 ||
    typeof manifest.generation !== "string" || manifest.generation !== generation ||
    !Array.isArray(manifest.allowedKeys) || !Array.isArray(manifest.blockedKeys) ||
    !manifest.allowedKeys.every(k => typeof k === "string") ||
    !manifest.blockedKeys.every(k => typeof k === "string")) {
    return reject(metrics, "MANIFEST_UNAVAILABLE", "Snapshot build visibility manifest missing, stale or invalid");
  }
  return manifest;
}

const ENTITY_KEY_PATTERN = /^snapshot\/(video|user|event)\/[a-zA-Z0-9_-]+\.json$/;
/** CURRENT `GET /api/public/about-stats` (RH-026) as one build-time object. */
export const ABOUT_STATS_KEY = "snapshot/about-stats/current.json";

export type AboutStatsSnapshot = Readonly<{ publicVideos: number; creators: number; events: number }>;

/** CURRENT `AboutStats.normalizeStats`: three safe non-negative integers or nothing. */
function validatedAboutStats(value: unknown): AboutStatsSnapshot | null {
  if (!isRecord(value)) return null;
  const publicVideos = Number(value.publicVideos);
  const creators = Number(value.creators);
  const events = Number(value.events);
  for (const n of [publicVideos, creators, events]) {
    if (!Number.isSafeInteger(n) || n < 0) return null;
  }
  return { publicVideos, creators, events };
}

/**
 * Verified envelope payload: manifest, key, size, JSON, generation, visibility and digest checks.
 * Shared by every snapshot kind; the caller projects the payload strictly.
 */
async function readVerifiedPayload(
  source: SnapshotSource,
  key: string,
  options: SnapshotLoadOptions,
  metrics: SnapshotBuildMetrics,
  keyPattern: RegExp,
): Promise<unknown> {
  const manifest = checkedManifest(options.manifest, options.generation, metrics);
  if (typeof key !== "string" || !keyPattern.test(key)) {
    return reject(metrics, "INVALID_KEY", "Invalid snapshot key");
  }
  if (manifest.blockedKeys.includes(key) || !manifest.allowedKeys.includes(key)) {
    return reject(metrics, "NOT_PUBLIC", "Snapshot denied by visibility manifest");
  }
  const maxBytes = options.maxBytes ?? MAX_OBJECT_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_OBJECT_BYTES) {
    return reject(metrics, "INVALID_LIMIT", "Invalid snapshot byte limit");
  }
  metrics.reads += 1;
  let bytes: Uint8Array | null;
  try {
    bytes = await source.read(key);
  } catch {
    return reject(metrics, "SOURCE_UNAVAILABLE", "Snapshot source unavailable");
  }
  if (!bytes) return reject(metrics, "SNAPSHOT_MISSING", "Public snapshot missing");
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxBytes || bytes.byteLength === 0) {
    return reject(metrics, "INVALID_SIZE", "Snapshot exceeds build size limit or is invalid");
  }
  metrics.bytes += bytes.byteLength;
  const start = performance.now();
  let parsed: unknown;
  try {
    parsed = JSON.parse(decode.decode(bytes));
  } catch {
    return reject(metrics, "INVALID_JSON", "Snapshot is not valid JSON/UTF-8");
  } finally {
    metrics.parseMs += performance.now() - start;
  }
  if (!isRecord(parsed)) return reject(metrics, "INVALID_ENVELOPE", "Snapshot envelope invalid");
  const envelope = parsed as SnapshotEnvelope;
  if (envelope.schemaVersion !== 1 || envelope.generation !== options.generation || envelope.key !== key) {
    return reject(metrics, "GENERATION_MISMATCH", "Snapshot generation, schema or key mismatch");
  }
  if (envelope.visibility !== "public") return reject(metrics, "NOT_PUBLIC", "Snapshot marked nonpublic");
  if (!HEX_256.test(envelope.sha256)) return reject(metrics, "INVALID_HASH", "Snapshot digest missing");
  const actualHash = createHash("sha256").update(JSON.stringify(envelope.payload)).digest("hex");
  if (actualHash !== envelope.sha256) return reject(metrics, "HASH_MISMATCH", "Snapshot digest mismatch");
  return envelope.payload;
}

/**
 * Strictly read a versioned, SHA-verified public-only projection.
 * Fail closed on private, stale, invalid, missing or oversized inputs.
 * Does not call D1, Queue, HTTP or production Workers.
 */
export async function loadPublicBuildSnapshot(
  source: SnapshotSource,
  key: string,
  options: SnapshotLoadOptions,
): Promise<PublicSnapshot> {
  const metrics = options.metrics ?? newSnapshotBuildMetrics();
  const payload = await readVerifiedPayload(source, key, options, metrics, ENTITY_KEY_PATTERN);
  const dto = validatedPublicDto(payload);
  if (!dto) return reject(metrics, "INVALID_PAYLOAD", "Snapshot public DTO invalid");
  const expectedKey = `snapshot/${dto.kind}/${dto.id}.json`;
  if (expectedKey !== key) return reject(metrics, "ENTITY_MISMATCH", "Snapshot entity ID does not match key");
  metrics.accepted += 1;
  return dto;
}

/** Listing artifacts rendered at build time by `/list`, `/recommend`, `/trending` (MIG-0505). */
export const LIST_FIRST_PAGE_KEY = "snapshot/list/first-page.json";
export const RECOMMEND_KEY = "snapshot/recommend/current.json";
export const TRENDING_KEY = "snapshot/trending/current.json";
/** CURRENT `top.json` as one build-time object for `/` (MIG-0506). */
export const TOP_KEY = "snapshot/top/current.json";
const LISTING_KEY_PATTERN = /^snapshot\/(list\/first-page|recommend\/current|trending\/current|top\/current)\.json$/;

/**
 * Verified payload of a listing snapshot (same manifest/generation/sha256/visibility checks as every kind).
 * The caller projects it with CURRENT's public-only normalizers, which drop every non-public row.
 */
export async function loadListingPayload(
  source: SnapshotSource,
  key: string,
  options: SnapshotLoadOptions,
): Promise<unknown> {
  const metrics = options.metrics ?? newSnapshotBuildMetrics();
  const payload = await readVerifiedPayload(source, key, options, metrics, LISTING_KEY_PATTERN);
  metrics.accepted += 1;
  return payload;
}

/** Same fail-closed checks as entities; the payload is the three RH-026 counts (MIG-0501). */
export async function loadAboutStatsSnapshot(
  source: SnapshotSource,
  options: SnapshotLoadOptions,
): Promise<AboutStatsSnapshot> {
  const metrics = options.metrics ?? newSnapshotBuildMetrics();
  const payload = await readVerifiedPayload(source, ABOUT_STATS_KEY, options, metrics, /^snapshot\/about-stats\/current\.json$/);
  const stats = validatedAboutStats(payload);
  if (!stats) return reject(metrics, "INVALID_PAYLOAD", "About stats payload invalid");
  metrics.accepted += 1;
  return stats;
}

/** CURRENT `users/index.json` (the R2 object `/user` reads) as one build-time object (MIG-0504). */
export const USERS_INDEX_KEY = "snapshot/users-index/current.json";
/**
 * CURRENT `users/<id>.json` and its paged siblings (`users/<id>/works/<n>.json`, `collabs/<n>.json`) as
 * build-time objects: `snapshot/user-profile/<x-id>[.works.<n>|.collabs.<n>].json` (n = 2..5).
 */
const USER_PROFILE_KEY_PATTERN = /^snapshot\/user-profile\/[a-z0-9_]{1,20}(\.(works|collabs)\.[2-9])?\.json$/;

export function userProfileSnapshotKey(xId: string, section?: "works" | "collabs", page?: number): string {
  return section && page
    ? `snapshot/user-profile/${xId}.${section}.${page}.json`
    : `snapshot/user-profile/${xId}.json`;
}

/**
 * Same fail-closed envelope checks as entities; the payload is returned as the CURRENT R2 JSON object.
 * The caller projects it with CURRENT `normalizeStaticUserProfile` / `normalizeStaticUsersIndex`, which
 * forward only known fields and drop non-public videos.
 */
async function loadPublicRecord(
  source: SnapshotSource,
  key: string,
  options: SnapshotLoadOptions,
  keyPattern: RegExp,
): Promise<Record<string, unknown>> {
  const metrics = options.metrics ?? newSnapshotBuildMetrics();
  const payload = await readVerifiedPayload(source, key, options, metrics, keyPattern);
  if (!isRecord(payload)) return reject(metrics, "INVALID_PAYLOAD", "Snapshot payload is not an object");
  metrics.accepted += 1;
  return payload;
}

export function loadUserProfileSnapshot(
  source: SnapshotSource,
  key: string,
  options: SnapshotLoadOptions,
): Promise<Record<string, unknown>> {
  return loadPublicRecord(source, key, options, USER_PROFILE_KEY_PATTERN);
}

export function loadUsersIndexSnapshot(
  source: SnapshotSource,
  options: SnapshotLoadOptions,
): Promise<Record<string, unknown>> {
  return loadPublicRecord(source, USERS_INDEX_KEY, options, /^snapshot\/users-index\/current\.json$/);
}
