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

function uniqueNonEmpty(values: readonly (string | null | undefined)[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => value?.trim() ?? "")
        .filter((value) => value.length > 0),
    ),
  ];
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
    const xUsers = uniqueNonEmpty(members.map((row) => row.x_user_id));
    if (xUsers.length > 1) {
      reports.push({
        kind: "mixed_x_user",
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
    const xUsers = uniqueNonEmpty(members.map((row) => row.x_user_id));
    const displayNames = uniqueNonEmpty(members.map((row) => row.display_name));
    if (authUsers.length > 1 || xUsers.length > 1 || displayNames.length > 1) {
      continue;
    }
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
