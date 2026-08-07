export const ACTIVE_X_BEFORE_SWITCH_EVENT = "flamenode:before-active-x-switch";
export const ACTIVE_X_CHANGED_EVENT = "flamenode:active-x-changed";

export type ActiveXSwitchDetail = {
  fromXId: string | null;
  toXId: string;
};

export function dispatchBeforeActiveXSwitch(
  detail: ActiveXSwitchDetail,
): boolean {
  if (typeof window === "undefined") return true;
  const event = new CustomEvent(ACTIVE_X_BEFORE_SWITCH_EVENT, {
    detail,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return !event.defaultPrevented;
}

export function dispatchActiveXChanged(detail: ActiveXSwitchDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(ACTIVE_X_CHANGED_EVENT, { detail }),
  );
}
