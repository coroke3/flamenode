import type { CanonicalLegacyPlan, LegacyImportStrategy } from "./normalize";

const PREVIEW_VERSION = 1 as const;
const PREVIEW_TTL_SECONDS = 15 * 60;
const CLAIM_TTL_SECONDS = 10 * 60;
const MAX_STORED_PLAN_BYTES = 24 * 1024 * 1024;
const TOKEN_PATTERN = /^[a-f0-9]{32}$/;

export type LegacyImportPreviewCredential = {
  previewToken: string;
  planHash: string;
  expiresAt: number;
};

export type ClaimedLegacyImportPreview = {
  plan: CanonicalLegacyPlan;
  strategy: LegacyImportStrategy;
  planHash: string;
  attempt: number;
  complete: () => Promise<void>;
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
  status: "ready" | "claimed";
  attempt: number;
  claimId?: string;
  claimExpiresAt?: number;
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
  if (
    record.version !== PREVIEW_VERSION ||
    typeof record.previewToken !== "string" ||
    typeof record.authUserId !== "string" ||
    typeof record.planHash !== "string" ||
    typeof record.createdAt !== "number" ||
    typeof record.expiresAt !== "number" ||
    (record.status !== "ready" && record.status !== "claimed") ||
    typeof record.attempt !== "number" ||
    !record.plan ||
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

function putOptions(record: StoredPreview, etagMatches?: string): R2PutOptions {
  return {
    ...(etagMatches ? { onlyIf: { etagMatches } } : {}),
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: {
      preview_version: String(PREVIEW_VERSION),
      plan_hash: record.planHash,
      expires_at: String(record.expiresAt),
      status: record.status,
    },
  };
}

export async function createLegacyImportPreview(
  bucket: R2Bucket | null | undefined,
  input: {
    authUserId: string;
    strategy: LegacyImportStrategy;
    plan: CanonicalLegacyPlan;
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
  if (!TOKEN_PATTERN.test(previewToken) || !/^[a-f0-9]{64}$/.test(input.planHash)) {
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
  const record = parseStoredPreview(await object.text());
  const now = options.now ?? nowSeconds();
  if (record.expiresAt <= now) {
    await safeBucket.delete(key);
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
  async function currentClaim(): Promise<{ object: R2ObjectBody; record: StoredPreview } | null> {
    const current = await safeBucket.get(key);
    if (!current) return null;
    const currentRecord = parseStoredPreview(await current.text());
    if (currentRecord.claimId !== claimId || currentRecord.status !== "claimed") return null;
    return { object: current, record: currentRecord };
  }

  return {
    plan: claimed.plan,
    strategy: claimed.strategy,
    planHash: claimed.planHash,
    attempt: claimed.attempt,
    complete: async () => {
      if (settled) return;
      const current = await currentClaim();
      if (!current) {
        throw new LegacyImportPreviewError(
          "preview planのclaimが失われたため完了処理を確定できません。",
          "claim_conflict",
        );
      }
      await safeBucket.delete(key);
      settled = true;
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
