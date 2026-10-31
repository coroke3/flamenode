import { z } from "zod";

/**
 * MIG-0603 U02a — transport inputs for SA-001..003 and SA-040..042.
 *
 * CURRENT reads FormData through String(value ?? "").trim(); the schemas
 * intentionally do NOT reject unknown status values, empty required fields,
 * or a non-"1" toggle. The existing @flamenode/domain/video validators must
 * determine status/required-field errors AFTER the request is normalized.
 * Authorisation, status transitions, and side effects belong to the Hono host.
 */
const formScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]).optional();

export const AdminVideoStatusBodySchema = z.object({
  video_id: formScalar,
  status: formScalar,
  reason: formScalar,
  case_id: formScalar,
  and_next: formScalar,
  force_notify: formScalar,
  void_reason_category: formScalar,
  review_event_id: formScalar,
});

export type AdminVideoStatusBody = z.infer<typeof AdminVideoStatusBodySchema>;

export const ManageVideoStatusBodySchema = z.object({
  event_id: formScalar,
  video_id: formScalar,
  status: formScalar,
  reason: formScalar,
  and_next: formScalar,
});

export type ManageVideoStatusBody = z.infer<typeof ManageVideoStatusBodySchema>;

const text = (value: string | number | boolean | null | undefined): string =>
  String(value ?? "").trim();

export function normalizeAdminVideoStatusBody(body: AdminVideoStatusBody) {
  const reviewEventId = text(body.review_event_id);
  return {
    videoId: text(body.video_id),
    status: text(body.status),
    reason: text(body.reason),
    caseId: text(body.case_id),
    andNext: body.and_next === "1",
    forceNotify: body.force_notify === "1",
    voidReasonCategory: text(body.void_reason_category),
    // CURRENT silently discards an invalid review filter; it does not deny
    // the status update or allow an oversized filter into the review query.
    adminEventFilter:
      reviewEventId && reviewEventId.length <= 128 ? reviewEventId : undefined,
  };
}

export function normalizeManageVideoStatusBody(body: ManageVideoStatusBody) {
  return {
    eventId: text(body.event_id),
    videoId: text(body.video_id),
    status: text(body.status),
    reason: text(body.reason),
    andNext: body.and_next === "1",
  };
}
