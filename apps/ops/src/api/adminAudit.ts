// D-16-1 provisional: replace with @flamenode/contracts at merge (restore API MIG-0662).
import type {
  AdminAuditDetailResponse, AdminAuditRestoreResponse, AdminAuditSettingsResponse,
  AuditLogDryRunResult, UpdateAuditLogSettingsResult,
} from "@flamenode/contracts";
import {
  AdminAuditDetailResponseSchema, AdminAuditRestoreResponseSchema, AdminAuditSettingsResponseSchema,
  AuditDryRunSchema, AuditSettingsPatchSchema,
} from "@flamenode/contracts";
import { send, type OpsWriteResult } from "./write.js";

export interface RestoreAuditResult {
  ok: boolean;
  message?: string;
  restore_run_id?: string;
  diff?: { current: Record<string,unknown> | null; target: Record<string,unknown> | null; conflicts: string[] };
}
export interface AuditMutations {
  detail(id: string, signal?: AbortSignal): Promise<OpsResult<AdminAuditDetailResponse>>;
  runs(signal?: AbortSignal): Promise<OpsResult<AdminAuditRestoreResponse>>;
  settings(signal?: AbortSignal): Promise<OpsResult<AdminAuditSettingsResponse>>;
  dryRun(auditId: string, reason: string): Promise<OpsWriteResult<AuditLogDryRunResult>>;
  restore(auditId: string, reason: string, confirm: string, force: boolean): Promise<OpsWriteResult<RestoreAuditResult>>;
  saveSettings(patch: AdminAuditSettingsResponse["settings"]): Promise<OpsWriteResult<UpdateAuditLogSettingsResult>>;
}
function auditMutationResult<T extends {ok:boolean;message?:string}>(result: OpsWriteResult<T>): OpsWriteResult<T> {
  if (result.status !== "ok") return result;
  if (typeof result.data.ok !== "boolean" ||
      (result.data.message !== undefined && typeof result.data.message !== "string")) {
    return {status:"unavailable"};
  }
  return result;
}
async function getValidated<T>(fetchFn: OpsFetch, path: string, schema: {safeParse(v: unknown): {success:boolean;data?:T}}, signal?: AbortSignal): Promise<OpsResult<T>> {
  const read = await getJson<unknown>(fetchFn,path,signal);
  if (read.status !== "ok") return read;
  const parsed = schema.safeParse(read.data);
  return parsed.success && parsed.data !== undefined
    ? {status:"ok",data:parsed.data} : {status:"unavailable"};
}
import {
  AdminAuditListResponseSchema,
  AdminAuditPayloadChunkResponseSchema,
  type AdminAuditListResponse,
} from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";
import { auditListApiPath, type AuditListQuery } from "../lib/auditListQuery.js";

export type AuditPayloadField = "before" | "after" | "inverse";
export type AuditAuditApi = AuditMutations & {
  list: (query: AuditListQuery, signal?: AbortSignal) => Promise<OpsResult<AdminAuditListResponse>>;
  payload: (id: string, field: AuditPayloadField, signal?: AbortSignal) => Promise<OpsResult<string | null>>;
};
const MAX_PAYLOAD_CHARS = 1_000_000;
const MAX_PAYLOAD_CHUNKS = 100;

export function createAdminAuditApi(fetchFn: OpsFetch = (input, init) => fetch(input, init)): AuditAuditApi {
  return {
    detail(id,signal) {
      return getValidated(fetchFn,"/api/admin-read/audit/" + encodeURIComponent(id), AdminAuditDetailResponseSchema, signal);
    },
    runs(signal) {
      return getValidated(fetchFn,"/api/admin-read/audit/restore",AdminAuditRestoreResponseSchema,signal);
    },
    settings(signal) {
      return getValidated(fetchFn,"/api/admin-read/audit-settings",AdminAuditSettingsResponseSchema,signal);
    },
    async dryRun(auditId,reason) {
      const body = AuditDryRunSchema.safeParse({audit_id:auditId,reason});
      if (!body.success) return {status:"ok",data:{ok:false,message:"理由を入力してください。"}};
      return auditMutationResult(await send<AuditLogDryRunResult>(fetchFn,"POST","/api/admin/audit/dry-run",body.data));
    },
    async restore(auditId,reason,confirm,force) {
      // Client-side guard supplements (never replaces) server-side restore confirmation.
      if (!reason.trim() || reason.trim().length>500 || confirm !== "RESTORE "+auditId || !auditId.trim()) {
        return {status:"ok",data:{ok:false,message:"確認テキストと理由を確認してください。"}};
      }
      return auditMutationResult(await send<RestoreAuditResult>(fetchFn,"POST","/api/admin/audit/restore",{
        audit_id:auditId,reason,confirm_text:confirm,force_overwrite:force?"1":"0",
      }));
    },
    async saveSettings(patch) {
      const data=AuditSettingsPatchSchema.safeParse(patch);
      if (!data.success || Object.keys(data.data).length!==5) {
        return {status:"ok",data:{ok:false,message:"入力エラー"}};
      }
      return auditMutationResult(await send<UpdateAuditLogSettingsResult>(fetchFn,"POST","/api/admin/audit/settings",data.data));
    },
    async list(query, signal) {
      const result = await getJson<unknown>(fetchFn, auditListApiPath(query), signal);
      if (result.status !== "ok") return result;
      const parsed = AdminAuditListResponseSchema.safeParse(result.data);
      return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
    },
    async payload(id, field, signal) {
      const path = "/api/admin-read/audit/" + encodeURIComponent(id) + "/payload/" + field;
      let offset = 0;
      let total: number | null = null;
      let body = "";
      let receivedChars = 0; // D1 length/substr counts Unicode code points, not JS UTF-16 units.
      for (let n = 0; n < MAX_PAYLOAD_CHUNKS; n++) {
        if (signal?.aborted) return { status: "unavailable" };
        const result = await getJson<unknown>(fetchFn, path + "?offset=" + offset, signal);
        // SQL NULL is represented as 404 by the source API, not as an empty JSON string.
        if (result.status === "notFound" && n === 0) return { status: "ok", data: null };
        if (result.status !== "ok") return result;
        const decoded = AdminAuditPayloadChunkResponseSchema.safeParse(result.data);
        if (!decoded.success) return { status: "unavailable" };
        const chunk = decoded.data;
        if (chunk.field !== field || chunk.offset !== offset ||
            chunk.total > MAX_PAYLOAD_CHARS || chunk.total < 0 ||
            (total !== null && total !== chunk.total) ||
            Array.from(chunk.chunk).length > 12_000) return { status: "unavailable" };
        total = chunk.total;
        body += chunk.chunk;
        receivedChars += Array.from(chunk.chunk).length;
        if (receivedChars > total) return { status: "unavailable" };
        if (chunk.nextOffset === null) {
          return receivedChars === total ? { status: "ok", data: body } : { status: "unavailable" };
        }
        if (chunk.nextOffset <= offset || chunk.nextOffset !== receivedChars || !chunk.chunk.length) {
          return { status: "unavailable" };
        }
        offset = chunk.nextOffset;
      }
      return { status: "unavailable" };
    },
  };
}
