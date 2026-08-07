export type SlotReservationSubjectRow = {
  id: string;
  event_id: string;
  reservation_group_id: string | null;
  reserved_by_user_id: string | null;
  x_user_id: string | null;
  display_name: string | null;
  status: "available" | "reserved" | "submitted";
  video_id: string | null;
};

export type SlotReservationGroupCandidate = {
  groupId: string;
  eventId: string;
  reservedByAuthUserId: string | null;
  xUserId: string | null;
  displayName: string | null;
  slotIds: string[];
};

export type SlotReservationAmbiguity =
  | "mixed_auth_user"
  | "mixed_x_user"
  | "inconsistent_x_user"
  | "mixed_display_name"
  | "cross_event"
  | "reserved_without_group"
  | "submitted_without_group"
  | "submitted_video_missing";

export type SlotReservationAmbiguousReport = {
  kind: SlotReservationAmbiguity;
  slotIds: string[];
  reservationGroupId?: string | null;
  eventId?: string | null;
};

export type SlotReservationSubject = {
  reservedByUserId: string;
  xUserId: string | null;
  displayName: string | null;
};

const SUBJECT_AMBIGUITY_KINDS: ReadonlySet<SlotReservationAmbiguity> = new Set([
  "mixed_auth_user",
  "mixed_x_user",
  "mixed_display_name",
  "cross_event",
]);

function trimDisplayName(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function strictFieldEqual<T>(values: readonly T[]): boolean {
  if (values.length === 0) return true;
  const first = values[0];
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] !== first) return false;
  }
  return true;
}

export function subjectsEqual(
  a: SlotReservationSubject,
  b: SlotReservationSubject,
): boolean {
  if (a.reservedByUserId !== b.reservedByUserId) return false;
  if (a.xUserId !== b.xUserId) return false;
  return trimDisplayName(a.displayName) === trimDisplayName(b.displayName);
}

export function resolveSlotReservationSubject(
  rows: readonly SlotReservationSubjectRow[],
): { ok: true; subject: SlotReservationSubject } | { ok: false; reason: string } {
  if (rows.length === 0) {
    return { ok: false, reason: "empty_rows" };
  }

  const rowIds = new Set(rows.map((row) => row.id));
  for (const report of collectSlotReservationAmbiguities(rows)) {
    if (!SUBJECT_AMBIGUITY_KINDS.has(report.kind)) continue;
    if (report.slotIds.some((slotId) => rowIds.has(slotId))) {
      return { ok: false, reason: report.kind };
    }
  }

  if (!strictFieldEqual(rows.map((row) => row.event_id))) {
    return { ok: false, reason: "cross_event" };
  }
  if (!strictFieldEqual(rows.map((row) => row.reserved_by_user_id))) {
    return { ok: false, reason: "mixed_auth_user" };
  }
  if (!strictFieldEqual(rows.map((row) => row.x_user_id))) {
    return { ok: false, reason: "mixed_x_user" };
  }
  if (
    !strictFieldEqual(rows.map((row) => trimDisplayName(row.display_name)))
  ) {
    return { ok: false, reason: "mixed_display_name" };
  }

  const reservedByUserId = rows[0]?.reserved_by_user_id?.trim() ?? "";
  if (!reservedByUserId) {
    return { ok: false, reason: "missing_auth_user" };
  }

  return {
    ok: true,
    subject: {
      reservedByUserId,
      xUserId: rows[0]?.x_user_id ?? null,
      displayName: trimDisplayName(rows[0]?.display_name),
    },
  };
}

function uniqueNonEmpty(values: readonly (string | null | undefined)[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => value?.trim() ?? "")
        .filter((value) => value.length > 0),
    ),
  ];
}

function analyzeXUserIdentity(
  members: readonly SlotReservationSubjectRow[],
): "consistent" | "mixed_x_user" | "inconsistent_x_user" {
  const xUsers = uniqueNonEmpty(members.map((row) => row.x_user_id));
  const hasNullOrEmpty = members.some((row) => !row.x_user_id?.trim());
  if (xUsers.length > 1) return "mixed_x_user";
  if (xUsers.length === 1 && hasNullOrEmpty) return "inconsistent_x_user";
  return "consistent";
}

export function collectSlotReservationAmbiguities(
  rows: readonly SlotReservationSubjectRow[],
): SlotReservationAmbiguousReport[] {
  const reports: SlotReservationAmbiguousReport[] = [];

  for (const row of rows) {
    if (row.status === "reserved" && !row.reservation_group_id?.trim()) {
      reports.push({
        kind: "reserved_without_group",
        slotIds: [row.id],
        eventId: row.event_id,
      });
    }
    if (row.status === "submitted" && !row.reservation_group_id?.trim()) {
      reports.push({
        kind: "submitted_without_group",
        slotIds: [row.id],
        eventId: row.event_id,
      });
    }
    if (row.status === "submitted" && !row.video_id?.trim()) {
      reports.push({
        kind: "submitted_video_missing",
        slotIds: [row.id],
        eventId: row.event_id,
        reservationGroupId: row.reservation_group_id,
      });
    }
  }

  const grouped = new Map<string, SlotReservationSubjectRow[]>();
  for (const row of rows) {
    const groupId = row.reservation_group_id?.trim();
    if (!groupId) continue;
    const bucket = grouped.get(groupId) ?? [];
    bucket.push(row);
    grouped.set(groupId, bucket);
  }

  for (const [groupId, members] of grouped) {
    const eventIds = uniqueNonEmpty(members.map((row) => row.event_id));
    if (eventIds.length > 1) {
      reports.push({
        kind: "cross_event",
        slotIds: members.map((row) => row.id),
        reservationGroupId: groupId,
      });
      continue;
    }
    const authUsers = uniqueNonEmpty(
      members.map((row) => row.reserved_by_user_id),
    );
    if (authUsers.length > 1) {
      reports.push({
        kind: "mixed_auth_user",
        slotIds: members.map((row) => row.id),
        reservationGroupId: groupId,
        eventId: eventIds[0] ?? null,
      });
    }
    const xIdentity = analyzeXUserIdentity(members);
    if (xIdentity !== "consistent") {
      reports.push({
        kind: xIdentity,
        slotIds: members.map((row) => row.id),
        reservationGroupId: groupId,
        eventId: eventIds[0] ?? null,
      });
    }
    const displayNames = uniqueNonEmpty(members.map((row) => row.display_name));
    if (displayNames.length > 1) {
      reports.push({
        kind: "mixed_display_name",
        slotIds: members.map((row) => row.id),
        reservationGroupId: groupId,
        eventId: eventIds[0] ?? null,
      });
    }
  }

  return reports;
}

export function buildSlotReservationGroupCandidates(
  rows: readonly SlotReservationSubjectRow[],
): {
  candidates: SlotReservationGroupCandidate[];
  ambiguities: SlotReservationAmbiguousReport[];
} {
  const ambiguities = collectSlotReservationAmbiguities(rows);
  const ambiguousGroupIds = new Set(
    ambiguities
      .map((report) => report.reservationGroupId)
      .filter((value): value is string => Boolean(value)),
  );
  const grouped = new Map<string, SlotReservationSubjectRow[]>();
  for (const row of rows) {
    const groupId = row.reservation_group_id?.trim();
    if (!groupId || ambiguousGroupIds.has(groupId)) continue;
    const bucket = grouped.get(groupId) ?? [];
    bucket.push(row);
    grouped.set(groupId, bucket);
  }

  const candidates: SlotReservationGroupCandidate[] = [];
  for (const [groupId, members] of grouped) {
    const eventIds = uniqueNonEmpty(members.map((row) => row.event_id));
    if (eventIds.length !== 1) continue;
    const authUsers = uniqueNonEmpty(
      members.map((row) => row.reserved_by_user_id),
    );
    const xIdentity = analyzeXUserIdentity(members);
    const displayNames = uniqueNonEmpty(members.map((row) => row.display_name));
    if (
      authUsers.length > 1 ||
      xIdentity !== "consistent" ||
      displayNames.length > 1
    ) {
      continue;
    }
    const xUsers = uniqueNonEmpty(members.map((row) => row.x_user_id));
    candidates.push({
      groupId,
      eventId: eventIds[0]!,
      reservedByAuthUserId: authUsers[0] ?? null,
      xUserId: xUsers[0] ?? null,
      displayName: displayNames[0] ?? null,
      slotIds: members.map((row) => row.id),
    });
  }

  return { candidates, ambiguities };
}
