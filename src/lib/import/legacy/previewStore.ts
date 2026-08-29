import { cancelR2BodyBestEffort } from "../../r2Body.ts";
import type { CanonicalLegacyPlan, LegacyImportStrategy } from "./normalize";

// v4はCloudflare CPU hard cap適用後のplanだけを許可する。
// v3の巨大planを新コードで再開させず、必ず範囲指定付きで再previewさせる。
const PREVIEW_VERSION = 4 as const;
const PREVIEW_TTL_SECONDS = 15 * 60;
const PREVIEW_MAX_LIFETIME_SECONDS = 6 * 60 * 60;
export const LEGACY_IMPORT_PREVIEW_MAX_LIFETIME_SECONDS = PREVIEW_MAX_LIFETIME_SECONDS;
// 1 HTTP = 1原子stepのため、応答断後に10分間claimを保持する必要はない。
// Workerが503で終了した場合も約1分で同じpreviewを手動再開できるようにする。
const CLAIM_TTL_SECONDS = 60;

function previewExpiresAt(createdAt: number, now: number): number {
  return Math.min(createdAt + PREVIEW_MAX_LIFETIME_SECONDS, now + PREVIEW_TTL_SECONDS);
}
// claim/advanceごとにplan全体をJSON parse/hash/CASするため、Worker CPUを守るhard cap。
// 大量取込はファイル別の行範囲を分け、複数previewとして処理する。
export const MAX_STORED_PLAN_BYTES = 512 * 1024;
export const LEGACY_IMPORT_PLAN_WARN_BYTES = Math.floor(MAX_STORED_PLAN_BYTES * 0.8);
const TOKEN_PATTERN = /^[a-f0-9]{32}$/;
const PLAN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const X_USER_STEP_SIZE = 40;
const SOFTWARE_STEP_SIZE = 40;
const QUESTION_STEP_SIZE = 6;

export type LegacyImportPreviewCredential = {
  previewToken: string;
  planHash: string;
  expiresAt: number;
};

export type LegacyImportApplyStage = "system_user" | "x_users" | "softwares" | "events" | "custom_questions" | "videos" | "complete";
export type LegacyImportApplyCounts = {
  createdEvents: number; replacedEvents: number; skippedEvents: number;
  createdVideos: number; replacedVideos: number; skippedVideos: number;
  createdXUsers: number; createdAuthUsers: number; createdSoftwares: number;
  createdCustomQuestions: number; reusedCustomQuestions: number;
};
export type LegacyImportApplyProgress = {
  stage: LegacyImportApplyStage;
  index: number;
  counts: LegacyImportApplyCounts;
  skipExistingEventIds: string[];
  skipExistingVideoIds: string[];
};
const APPLY_STAGES: LegacyImportApplyStage[] = ["system_user", "x_users", "softwares", "events", "custom_questions", "videos", "complete"];

export type ClaimedLegacyImportPreview = {
  plan: CanonicalLegacyPlan;
  strategy: LegacyImportStrategy;
  planHash: string;
  attempt: number;
  completed: boolean;
  readonly progress: LegacyImportApplyProgress;
  advance: (nextProgress: LegacyImportApplyProgress) => Promise<number>;
  complete: () => Promise<number>;
  release: () => Promise<void>;
};

type StoredPreview = {
  version: typeof PREVIEW_VERSION;
  previewToken: string;
  authUserId: string;
  strategy: LegacyImportStrategy;
  planHash: string;
  plan: CanonicalLegacyPlan;
  createdAt: number;
  expiresAt: number;
  status: "ready" | "claimed" | "completed";
  attempt: number;
  claimId?: string;
  claimExpiresAt?: number;
  completedAt?: number;
  progress: LegacyImportApplyProgress;
};

type CreateOptions = {
  now?: number;
  previewToken?: string;
};

type ClaimOptions = {
  now?: number;
  claimId?: string;
};

type LegacyImportPreviewErrorCode =
  | "bucket_unavailable"
  | "invalid_token"
  | "not_found"
  | "expired"
  | "owner_mismatch"
  | "hash_mismatch"
  | "already_claimed"
  | "claim_conflict"
  | "invalid_record"
  | "plan_too_large";

export class LegacyImportPreviewError extends Error {
  readonly code: LegacyImportPreviewErrorCode;

  constructor(message: string, code: LegacyImportPreviewErrorCode) {
    super(message);
    this.name = "LegacyImportPreviewError";
    this.code = code;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function randomToken(): string {
  return crypto.randomUUID().replaceAll("-", "").toLowerCase();
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function planEnvelope(
  authUserId: string,
  strategy: LegacyImportStrategy,
  plan: CanonicalLegacyPlan,
): string {
  return JSON.stringify({ version: PREVIEW_VERSION, authUserId, strategy, plan });
}

async function previewKey(authUserId: string, previewToken: string): Promise<string> {
  const ownerHash = (await sha256Hex(authUserId)).slice(0, 24);
  return `legacy-import-preview/v${PREVIEW_VERSION}/${ownerHash}/${previewToken}.json`;
}

function assertBucket(bucket: R2Bucket | null | undefined): asserts bucket is R2Bucket {
  if (
    !bucket ||
    typeof bucket.get !== "function" ||
    typeof bucket.put !== "function" ||
    typeof bucket.delete !== "function"
  ) {
    throw new LegacyImportPreviewError(
      "旧形式インポート用R2バケットが利用できません。",
      "bucket_unavailable",
    );
  }
}

function isValidApplyProgress(value: unknown): value is LegacyImportApplyProgress {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<LegacyImportApplyProgress>;
  const c = p.counts as Partial<LegacyImportApplyCounts> | undefined;
  const keys: (keyof LegacyImportApplyCounts)[] = ["createdEvents", "replacedEvents", "skippedEvents", "createdVideos", "replacedVideos", "skippedVideos", "createdXUsers", "createdAuthUsers", "createdSoftwares", "createdCustomQuestions", "reusedCustomQuestions"];
  if (
    !APPLY_STAGES.includes(p.stage as LegacyImportApplyStage) ||
    !Number.isSafeInteger(p.index) ||
    (p.index as number) < 0 ||
    !c ||
    !keys.every((key) => Number.isSafeInteger(c[key]) && (c[key] as number) >= 0) ||
    !Array.isArray(p.skipExistingEventIds) ||
    !p.skipExistingEventIds.every((id) => typeof id === "string" && id.length > 0) ||
    new Set(p.skipExistingEventIds).size !== p.skipExistingEventIds.length ||
    !Array.isArray(p.skipExistingVideoIds) ||
    !p.skipExistingVideoIds.every((id) => typeof id === "string" && id.length > 0) ||
    new Set(p.skipExistingVideoIds).size !== p.skipExistingVideoIds.length
  ) {
    return false;
  }
  return JSON.stringify(p.skipExistingEventIds) === JSON.stringify([...p.skipExistingEventIds].sort()) &&
    JSON.stringify(p.skipExistingVideoIds) === JSON.stringify([...p.skipExistingVideoIds].sort());
}

function softwareCount(plan: CanonicalLegacyPlan): number {
  const softwareNames = new Set(
    plan.videoSoftwares
      .map((row) => row.label.trim().replace(/\s+/g, " ").toLowerCase())
      .filter(Boolean),
  );
  return softwareNames.size;
}

function stageLimits(plan: CanonicalLegacyPlan): Record<LegacyImportApplyStage, number> {
  const softwares = softwareCount(plan);
  return {
    system_user: 1,
    x_users: Math.max(1, Math.ceil(plan.xUsers.length / X_USER_STEP_SIZE)),
    softwares: Math.max(1, Math.ceil(softwares / SOFTWARE_STEP_SIZE)),
    events: Math.max(1, plan.events.length),
    custom_questions: Math.max(1, Math.ceil(plan.eventCustomQuestions.length / QUESTION_STEP_SIZE)),
    videos: Math.max(1, plan.videos.length),
    complete: 1,
  };
}

function progressWithinPlan(plan: CanonicalLegacyPlan, progress: LegacyImportApplyProgress): boolean {
  const limits = stageLimits(plan);
  const eventTotal = progress.counts.createdEvents + progress.counts.replacedEvents + progress.counts.skippedEvents;
  const videoTotal = progress.counts.createdVideos + progress.counts.replacedVideos + progress.counts.skippedVideos;
  const questionTotal = progress.counts.createdCustomQuestions + progress.counts.reusedCustomQuestions;
  const countsWithinPlan =
    eventTotal <= plan.events.length &&
    videoTotal <= plan.videos.length &&
    progress.counts.createdXUsers <= plan.xUsers.length &&
    progress.counts.createdAuthUsers <= plan.xUsers.length &&
    progress.counts.createdSoftwares <= softwareCount(plan) &&
    questionTotal <= plan.eventCustomQuestions.length;
  const planVideoIds = new Set(plan.videos.map((video) => video.id));
  const planEventIds = new Set(plan.events.map((event) => event.id));
  return countsWithinPlan &&
    progress.index < limits[progress.stage] &&
    progress.skipExistingEventIds.every((id) => planEventIds.has(id)) &&
    progress.skipExistingVideoIds.every((id) => planVideoIds.has(id));
}

function nextPosition(
  plan: CanonicalLegacyPlan,
  progress: LegacyImportApplyProgress,
): Pick<LegacyImportApplyProgress, "stage" | "index"> | null {
  switch (progress.stage) {
    case "system_user":
      return { stage: "x_users", index: 0 };
    case "x_users":
      return progress.index + 1 < stageLimits(plan).x_users
        ? { stage: "x_users", index: progress.index + 1 }
        : { stage: "softwares", index: 0 };
    case "softwares":
      return progress.index + 1 < stageLimits(plan).softwares
        ? { stage: "softwares", index: progress.index + 1 }
        : { stage: "events", index: 0 };
    case "events":
      return progress.index + 1 < stageLimits(plan).events
        ? { stage: "events", index: progress.index + 1 }
        : { stage: "custom_questions", index: 0 };
    case "custom_questions":
      return progress.index + 1 < stageLimits(plan).custom_questions
        ? { stage: "custom_questions", index: progress.index + 1 }
        : { stage: "videos", index: 0 };
    case "videos":
      return progress.index + 1 < stageLimits(plan).videos
        ? { stage: "videos", index: progress.index + 1 }
        : { stage: "complete", index: 0 };
    case "complete":
      return null;
  }
}

function countTransitionValid(
  plan: CanonicalLegacyPlan,
  previous: LegacyImportApplyProgress,
  next: LegacyImportApplyProgress,
): boolean {
  const keys = Object.keys(previous.counts) as (keyof LegacyImportApplyCounts)[];
  const deltas = Object.fromEntries(
    keys.map((key) => [key, next.counts[key] - previous.counts[key]]),
  ) as LegacyImportApplyCounts;
  if (keys.some((key) => deltas[key] < 0)) return false;
  const only = (allowed: readonly (keyof LegacyImportApplyCounts)[]) =>
    keys.every((key) => allowed.includes(key) || deltas[key] === 0);

  switch (previous.stage) {
    case "system_user":
      return keys.every((key) => deltas[key] === 0);
    case "x_users": {
      const remaining = Math.max(0, plan.xUsers.length - previous.index * X_USER_STEP_SIZE);
      return (
        only(["createdXUsers", "createdAuthUsers"]) &&
        deltas.createdXUsers <= Math.min(X_USER_STEP_SIZE, remaining) &&
        deltas.createdAuthUsers <= Math.min(X_USER_STEP_SIZE, remaining)
      );
    }
    case "softwares": {
      const remaining = Math.max(0, softwareCount(plan) - previous.index * SOFTWARE_STEP_SIZE);
      return only(["createdSoftwares"]) && deltas.createdSoftwares <= Math.min(SOFTWARE_STEP_SIZE, remaining);
    }
    case "events": {
      const delta = deltas.createdEvents + deltas.replacedEvents + deltas.skippedEvents;
      return only(["createdEvents", "replacedEvents", "skippedEvents"]) && delta === (plan.events.length ? 1 : 0);
    }
    case "custom_questions": {
      const remaining = Math.max(0, plan.eventCustomQuestions.length - previous.index * QUESTION_STEP_SIZE);
      const delta = deltas.createdCustomQuestions + deltas.reusedCustomQuestions;
      return only(["createdCustomQuestions", "reusedCustomQuestions"]) && delta <= Math.min(QUESTION_STEP_SIZE, remaining);
    }
    case "videos": {
      const delta = deltas.createdVideos + deltas.replacedVideos + deltas.skippedVideos;
      return only(["createdVideos", "replacedVideos", "skippedVideos"]) && delta === (plan.videos.length ? 1 : 0);
    }
    case "complete":
      return false;
  }
}

function parseStoredPreview(raw: string): StoredPreview {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new LegacyImportPreviewError("保存済みpreview planが破損しています。", "invalid_record");
  }
  if (!value || typeof value !== "object") {
    throw new LegacyImportPreviewError("保存済みpreview planが不正です。", "invalid_record");
  }
  const record = value as Partial<StoredPreview>;
  const plan = record.plan as Partial<CanonicalLegacyPlan> | undefined;
  const planArrays: (keyof CanonicalLegacyPlan)[] = [
    "events", "eventStaff", "xUsers", "videos", "videoEvents", "videoMembers",
    "videoChapters", "videoSoftwares", "eventCustomQuestions", "videoCustomAnswers",
    "videoFieldDecisions", "unmappedVideoFields", "warnings", "errors",
  ];
  if (
    record.version !== PREVIEW_VERSION ||
    typeof record.previewToken !== "string" ||
    typeof record.authUserId !== "string" ||
    typeof record.planHash !== "string" ||
    !PLAN_HASH_PATTERN.test(record.planHash) ||
    typeof record.createdAt !== "number" ||
    typeof record.expiresAt !== "number" ||
    (record.status !== "ready" && record.status !== "claimed" && record.status !== "completed") ||
    typeof record.attempt !== "number" ||
    !isValidApplyProgress(record.progress) ||
    !plan ||
    !planArrays.every((key) => Array.isArray(plan[key])) ||
    !progressWithinPlan(plan as CanonicalLegacyPlan, record.progress) ||
    (record.status === "claimed" &&
      (typeof record.claimId !== "string" || typeof record.claimExpiresAt !== "number")) ||
    (record.status === "completed" &&
      (record.progress.stage !== "complete" || typeof record.completedAt !== "number")) ||
    (record.strategy !== "create_only" &&
      record.strategy !== "skip_existing" &&
      record.strategy !== "replace_imported")
  ) {
    throw new LegacyImportPreviewError("保存済みpreview planの形式が不正です。", "invalid_record");
  }
  return record as StoredPreview;
}

function serializedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function readStoredPreviewObject(object: R2ObjectBody): Promise<StoredPreview> {
  if (
    typeof object.size === "number" &&
    (!Number.isSafeInteger(object.size) ||
      object.size < 0 ||
      object.size > MAX_STORED_PLAN_BYTES)
  ) {
    await cancelR2BodyBestEffort(object);
    throw new LegacyImportPreviewError(
      "保存済みpreview planが大きすぎます。再度プレビューしてください。",
      "plan_too_large",
    );
  }
  return parseStoredPreview(await object.text());
}

export function estimateLegacyImportStoredPlanBytes(input: {
  authUserId: string;
  strategy: LegacyImportStrategy;
  plan: CanonicalLegacyPlan;
}): number {
  const record: StoredPreview = {
    version: PREVIEW_VERSION,
    previewToken: "0".repeat(32),
    authUserId: input.authUserId,
    strategy: input.strategy,
    planHash: "0".repeat(64),
    plan: input.plan,
    createdAt: 0,
    expiresAt: 0,
    status: "ready",
    attempt: 0,
    progress: {
      stage: "system_user",
      index: 0,
      counts: {
        createdEvents: 0,
        replacedEvents: 0,
        skippedEvents: 0,
        createdVideos: 0,
        replacedVideos: 0,
        skippedVideos: 0,
        createdXUsers: 0,
        createdAuthUsers: 0,
        createdSoftwares: 0,
        createdCustomQuestions: 0,
        reusedCustomQuestions: 0,
      },
      skipExistingEventIds: [],
      skipExistingVideoIds: [],
    },
  };
  return serializedBytes(JSON.stringify(record));
}

function putOptions(record: StoredPreview, etagMatches?: string): R2PutOptions {
  return {
    ...(etagMatches ? { onlyIf: { etagMatches } } : {}),
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: {
      preview_version: String(PREVIEW_VERSION),
      plan_hash: record.planHash,
      expires_at: String(record.expiresAt),
      status: record.status,
      stage: record.progress.stage,
      index: String(record.progress.index),
    },
  };
}

export async function createLegacyImportPreview(
  bucket: R2Bucket | null | undefined,
  input: {
    authUserId: string;
    strategy: LegacyImportStrategy;
    plan: CanonicalLegacyPlan;
    skipExistingEventIds?: readonly string[];
    skipExistingVideoIds?: readonly string[];
  },
  options: CreateOptions = {},
): Promise<LegacyImportPreviewCredential> {
  assertBucket(bucket);
  const safeBucket = bucket;
  const now = options.now ?? nowSeconds();
  const previewToken = (options.previewToken ?? randomToken()).toLowerCase();
  if (!TOKEN_PATTERN.test(previewToken)) {
    throw new LegacyImportPreviewError("preview tokenの形式が不正です。", "invalid_token");
  }
  const planHash = await sha256Hex(planEnvelope(input.authUserId, input.strategy, input.plan));
  const planEventIds = new Set(input.plan.events.map((event) => event.id));
  const planVideoIds = new Set(input.plan.videos.map((video) => video.id));
  const skipExistingEventIds = input.strategy === "skip_existing"
    ? [...new Set(input.skipExistingEventIds ?? [])].sort()
    : [];
  const skipExistingVideoIds = input.strategy === "skip_existing"
    ? [...new Set(input.skipExistingVideoIds ?? [])].sort()
    : [];
  if (
    skipExistingEventIds.some((id) => !planEventIds.has(id)) ||
    skipExistingVideoIds.some((id) => !planVideoIds.has(id))
  ) {
    throw new LegacyImportPreviewError("既存ID snapshotがplanと一致しません。", "invalid_record");
  }
  const record: StoredPreview = {
    version: PREVIEW_VERSION,
    previewToken,
    authUserId: input.authUserId,
    strategy: input.strategy,
    planHash,
    plan: input.plan,
    createdAt: now,
    expiresAt: now + PREVIEW_TTL_SECONDS,
    status: "ready",
    attempt: 0,
    progress: {
      stage: "system_user",
      index: 0,
      counts: {
        createdEvents: 0,
        replacedEvents: 0,
        skippedEvents: 0,
        createdVideos: 0,
        replacedVideos: 0,
        skippedVideos: 0,
        createdXUsers: 0,
        createdAuthUsers: 0,
        createdSoftwares: 0,
        createdCustomQuestions: 0,
        reusedCustomQuestions: 0,
      },
      skipExistingEventIds,
      skipExistingVideoIds,
    },
  };
  const serialized = JSON.stringify(record);
  if (serializedBytes(serialized) > MAX_STORED_PLAN_BYTES) {
    throw new LegacyImportPreviewError(
      "正規化後のplanが大きすぎます。ファイルを分割してください。",
      "plan_too_large",
    );
  }
  const key = await previewKey(input.authUserId, previewToken);
  const stored = await safeBucket.put(key, serialized, putOptions(record));
  if (!stored) {
    throw new LegacyImportPreviewError("preview planをR2へ保存できませんでした。", "claim_conflict");
  }
  return { previewToken, planHash, expiresAt: record.expiresAt };
}

export async function claimLegacyImportPreview(
  bucket: R2Bucket | null | undefined,
  input: {
    authUserId: string;
    previewToken: string;
    planHash: string;
  },
  options: ClaimOptions = {},
): Promise<ClaimedLegacyImportPreview> {
  assertBucket(bucket);
  const safeBucket = bucket;
  const previewToken = input.previewToken.toLowerCase();
  if (!TOKEN_PATTERN.test(previewToken) || !PLAN_HASH_PATTERN.test(input.planHash)) {
    throw new LegacyImportPreviewError("preview tokenまたはplan hashが不正です。", "invalid_token");
  }
  const key = await previewKey(input.authUserId, previewToken);
  const object = await safeBucket.get(key);
  if (!object) {
    throw new LegacyImportPreviewError(
      "preview planが見つかりません。再度プレビューしてください。",
      "not_found",
    );
  }
  const record = await readStoredPreviewObject(object);
  const now = options.now ?? nowSeconds();
  if (record.expiresAt <= now) {
    throw new LegacyImportPreviewError(
      "previewの有効期限が切れました。再度プレビューしてください。",
      "expired",
    );
  }
  if (record.authUserId !== input.authUserId || record.previewToken !== previewToken) {
    throw new LegacyImportPreviewError("このpreview planを利用する権限がありません。", "owner_mismatch");
  }
  const actualHash = await sha256Hex(planEnvelope(record.authUserId, record.strategy, record.plan));
  if (record.planHash !== input.planHash || actualHash !== input.planHash) {
    throw new LegacyImportPreviewError(
      "preview後にplanが変更されています。再度プレビューしてください。",
      "hash_mismatch",
    );
  }
  if (record.status === "completed") {
    return {
      plan: record.plan,
      strategy: record.strategy,
      planHash: record.planHash,
      attempt: record.attempt,
      completed: true,
      progress: record.progress,
      advance: async () => {
        throw new LegacyImportPreviewError("完了済みpreviewの進捗は変更できません。", "claim_conflict");
      },
      complete: async () => record.expiresAt,
      release: async () => undefined,
    };
  }
  if (record.status === "claimed" && (record.claimExpiresAt ?? record.expiresAt) > now) {
    throw new LegacyImportPreviewError(
      "同じpreview planを別の処理が適用中です。二重送信はできません。",
      "already_claimed",
    );
  }

  const claimId = (options.claimId ?? randomToken()).toLowerCase();
  const claimed: StoredPreview = {
    ...record,
    status: "claimed",
    attempt: record.attempt + 1,
    claimId,
    claimExpiresAt: Math.min(record.expiresAt, now + CLAIM_TTL_SECONDS),
  };
  const claimedObject = await safeBucket.put(
    key,
    JSON.stringify(claimed),
    putOptions(claimed, object.etag),
  );
  if (!claimedObject) {
    throw new LegacyImportPreviewError(
      "preview planの適用権を取得できませんでした。再度お試しください。",
      "claim_conflict",
    );
  }

  let settled = false;
  let settledExpiresAt = claimed.expiresAt;
  const claimClock = () => options.now ?? nowSeconds();

  function validateAdvanceProgress(
    current: { object: R2ObjectBody; record: StoredPreview },
    nextProgress: LegacyImportApplyProgress,
  ): void {
    if (!isValidApplyProgress(nextProgress)) {
      throw new LegacyImportPreviewError("preview progress is invalid", "invalid_record");
    }
    const expectedPosition = nextPosition(current.record.plan, current.record.progress);
    const validStep = !!expectedPosition &&
      nextProgress.stage === expectedPosition.stage &&
      nextProgress.index === expectedPosition.index;
    const skipSnapshotValid =
      JSON.stringify(nextProgress.skipExistingEventIds) ===
        JSON.stringify(current.record.progress.skipExistingEventIds) &&
      JSON.stringify(nextProgress.skipExistingVideoIds) ===
        JSON.stringify(current.record.progress.skipExistingVideoIds);
    if (
      !validStep ||
      !countTransitionValid(current.record.plan, current.record.progress, nextProgress) ||
      !skipSnapshotValid ||
      !progressWithinPlan(current.record.plan, nextProgress)
    ) {
      throw new LegacyImportPreviewError("preview progress must advance monotonically", "claim_conflict");
    }
  }
  async function currentClaim(): Promise<{ object: R2ObjectBody; record: StoredPreview } | null> {
    const current = await safeBucket.get(key);
    if (!current) return null;
    const currentRecord = await readStoredPreviewObject(current);
    if (currentRecord.claimId !== claimId || currentRecord.status !== "claimed") return null;
    const currentNow = claimClock();
    if (currentRecord.expiresAt <= currentNow || (currentRecord.claimExpiresAt ?? 0) <= currentNow) {
      return null;
    }
    return { object: current, record: currentRecord };
  }

  return {
    plan: claimed.plan,
    strategy: claimed.strategy,
    planHash: claimed.planHash,
    attempt: claimed.attempt,
    completed: false,
    progress: claimed.progress,
    advance: async (nextProgress: LegacyImportApplyProgress) => {
      if (settled) {
        throw new LegacyImportPreviewError("preview claim is already settled", "claim_conflict");
      }
      const current = await currentClaim();
      if (!current) {
        throw new LegacyImportPreviewError("preview claim is no longer valid", "claim_conflict");
      }
      validateAdvanceProgress(current, nextProgress);
      const now = claimClock();
      const next: StoredPreview = nextProgress.stage === "complete"
        ? {
            ...current.record,
            status: "completed",
            progress: nextProgress,
            claimId: undefined,
            claimExpiresAt: undefined,
            completedAt: now,
            expiresAt: previewExpiresAt(current.record.createdAt, now),
          }
        : {
            ...current.record,
            status: "ready",
            progress: nextProgress,
            claimId: undefined,
            claimExpiresAt: undefined,
            expiresAt: previewExpiresAt(current.record.createdAt, now),
          };
      const advanced = await safeBucket.put(key, JSON.stringify(next), putOptions(next, current.object.etag));
      if (!advanced) {
        throw new LegacyImportPreviewError("preview progress update conflicted", "claim_conflict");
      }
      settled = true;
      settledExpiresAt = next.expiresAt;
      return next.expiresAt;
    },
    complete: async () => {
      if (settled) return settledExpiresAt;
      const current = await currentClaim();
      if (!current) {
        throw new LegacyImportPreviewError(
          "preview planのclaimが失われたため完了処理を確定できません。",
          "claim_conflict",
        );
      }
      if (current.record.progress.stage !== "complete") {
        throw new LegacyImportPreviewError("未完了のpreview planは完了にできません。", "claim_conflict");
      }
      const now = claimClock();
      const completed: StoredPreview = {
        ...current.record,
        status: "completed",
        claimId: undefined,
        claimExpiresAt: undefined,
        completedAt: now,
        expiresAt: previewExpiresAt(current.record.createdAt, now),
      };
      const stored = await safeBucket.put(
        key,
        JSON.stringify(completed),
        putOptions(completed, current.object.etag),
      );
      if (!stored) {
        throw new LegacyImportPreviewError("preview planの完了確定が競合しました。", "claim_conflict");
      }
      settled = true;
      settledExpiresAt = completed.expiresAt;
      return completed.expiresAt;
    },
    release: async () => {
      if (settled) return;
      const current = await currentClaim();
      if (!current) return;
      const ready: StoredPreview = {
        ...current.record,
        status: "ready",
        claimId: undefined,
        claimExpiresAt: undefined,
      };
      const released = await safeBucket.put(
        key,
        JSON.stringify(ready),
        putOptions(ready, current.object.etag),
      );
      if (!released) {
        throw new LegacyImportPreviewError(
          "preview planのclaimを安全に解放できませんでした。期限切れ後に再プレビューしてください。",
          "claim_conflict",
        );
      }
      settled = true;
    },
  };
}
