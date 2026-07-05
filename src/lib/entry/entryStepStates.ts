export type EntryStepState = "done" | "current" | "warn" | "error" | "pending";

export type EntryStepKey =
  | "login"
  | "terms"
  | "x-select"
  | "x-approve"
  | "event"
  | "post";

const STEP_ORDER: EntryStepKey[] = [
  "login",
  "terms",
  "x-select",
  "x-approve",
  "event",
  "post",
];

function markCurrent(
  current: EntryStepKey,
  overrides: Partial<Record<EntryStepKey, EntryStepState>> = {},
): Record<EntryStepKey, EntryStepState> {
  const states = Object.fromEntries(
    STEP_ORDER.map((key) => [key, "pending"]),
  ) as Record<EntryStepKey, EntryStepState>;

  let passedCurrent = false;
  for (const key of STEP_ORDER) {
    if (key === current) {
      states[key] = overrides[key] ?? "current";
      passedCurrent = true;
      continue;
    }
    states[key] = passedCurrent
      ? (overrides[key] ?? "pending")
      : (overrides[key] ?? "done");
  }

  return { ...states, ...overrides };
}

export function resolveEntryStepStates(input: {
  isLoggedIn: boolean;
  needsTosAccept: boolean;
  activeX: string | null;
  activeXApprovalStatus: "approved" | "pending" | "rejected" | "imported" | null;
  hasReservedSlots: boolean;
  canPost: boolean;
}): Record<EntryStepKey, EntryStepState> {
  const {
    isLoggedIn,
    needsTosAccept,
    activeX,
    activeXApprovalStatus,
    hasReservedSlots,
    canPost,
  } = input;

  if (!isLoggedIn) {
    return markCurrent("login");
  }

  if (needsTosAccept) {
    return markCurrent("terms", { login: "done" });
  }

  if (!activeX) {
    return markCurrent("x-select", { login: "done", terms: "done" });
  }

  if (activeXApprovalStatus === "rejected") {
    return markCurrent("x-approve", {
      login: "done",
      terms: "done",
      "x-select": "done",
      "x-approve": "error",
    });
  }

  if (activeXApprovalStatus === "pending") {
    return markCurrent("event", {
      login: "done",
      terms: "done",
      "x-select": "done",
      "x-approve": "warn",
    });
  }

  if (activeXApprovalStatus !== "approved") {
    return markCurrent("x-approve", {
      login: "done",
      terms: "done",
      "x-select": "done",
    });
  }

  if (canPost && hasReservedSlots) {
    return {
      login: "done",
      terms: "done",
      "x-select": "done",
      "x-approve": "done",
      event: "done",
      post: "current",
    };
  }

  if (canPost) {
    return markCurrent("event", {
      login: "done",
      terms: "done",
      "x-select": "done",
      "x-approve": "done",
    });
  }

  return markCurrent("event", {
    login: "done",
    terms: "done",
    "x-select": "done",
    "x-approve": "warn",
  });
}
