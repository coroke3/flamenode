import {
  AdminAuditListResponseSchema,
  AdminAuditPayloadChunkResponseSchema,
  type AdminAuditListResponse,
} from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";
import { auditListApiPath, type AuditListQuery } from "../lib/auditListQuery.js";

export type AuditPayloadField = "before" | "after" | "inverse";
export type AuditAuditApi = {
  list: (query: AuditListQuery, signal?: AbortSignal) => Promise<OpsResult<AdminAuditListResponse>>;
  payload: (id: string, field: AuditPayloadField, signal?: AbortSignal) => Promise<OpsResult<string | null>>;
};
const MAX_PAYLOAD_CHARS = 1_000_000;
const MAX_PAYLOAD_CHUNKS = 100;

export function createAdminAuditApi(fetchFn: OpsFetch = (input, init) => fetch(input, init)): AuditAuditApi {
  return {
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
            chunk.chunk.length > 12_000) return { status: "unavailable" };
        total = chunk.total;
        body += chunk.chunk;
        if (body.length > total) return { status: "unavailable" };
        if (chunk.nextOffset === null) {
          return body.length === total ? { status: "ok", data: body } : { status: "unavailable" };
        }
        if (chunk.nextOffset <= offset || chunk.nextOffset !== body.length || !chunk.chunk.length) {
          return { status: "unavailable" };
        }
        offset = chunk.nextOffset;
      }
      return { status: "unavailable" };
    },
  };
}
