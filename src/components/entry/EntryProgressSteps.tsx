import * as React from "react";
import { Icon } from "@/components/ui/Icon";

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

const STEP_LABELS: Record<EntryStepKey, string> = {
  login: "ログイン",
  terms: "利用規約",
  "x-select": "X ID選択",
  "x-approve": "X ID承認",
  event: "イベント選択 / 枠確保",
  post: "投稿",
};

const STATE_LABELS: Record<EntryStepState, string> = {
  done: "完了",
  current: "現在",
  warn: "注意",
  error: "エラー",
  pending: "未完了",
};

interface EntryProgressStepsProps {
  states: Record<EntryStepKey, EntryStepState>;
}

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
  activeXApprovalStatus: "approved" | "pending" | "rejected" | null;
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

function stepIcon(state: EntryStepState): React.ReactElement {
  if (state === "done") return <Icon name="check" size={12} aria-hidden />;
  if (state === "error") return <Icon name="alert" size={12} aria-hidden />;
  if (state === "warn") return <Icon name="warning" size={12} aria-hidden />;
  if (state === "current") return <Icon name="edit" size={12} aria-hidden />;
  return <Icon name="clock" size={12} aria-hidden />;
}

export function EntryProgressSteps({
  states,
}: EntryProgressStepsProps): React.ReactElement {
  return (
    <nav className="fn-entry-steps" aria-label="参加・投稿の進捗">
      <ol className="fn-entry-steps-list">
        {STEP_ORDER.map((key, index) => {
          const state = states[key];
          return (
            <li
              key={key}
              className={`fn-entry-step fn-entry-step--${state}`}
              data-state={state}
            >
              <span className="fn-entry-step-index" aria-hidden>
                {index + 1}
              </span>
              <span className="fn-entry-step-body">
                <span className="fn-entry-step-label">{STEP_LABELS[key]}</span>
                <span className="fn-entry-step-state">
                  {stepIcon(state)}
                  <span className="fn-sr-only">{STATE_LABELS[state]}</span>
                  <span aria-hidden>{STATE_LABELS[state]}</span>
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
