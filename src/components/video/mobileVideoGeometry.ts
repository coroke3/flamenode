export const MOBILE_QUERY = "(max-width: 900px)";
export const VIDEO_ASPECT_RATIO = 16 / 9;
export const LANDSCAPE_MIN_CONTENT_HEIGHT_PX = 160;
export const SCROLL_THROTTLE_MS = 90;

export type MobileVideoGeometryInput = {
  headerBottom: number;
  viewportHeight: number;
  viewportWidth: number;
  viewportTop: number;
  viewportLeft: number;
  windowInnerHeight: number;
};

export type MobileVideoGeometryMetrics = {
  effectiveHeaderBottom: number;
  playerLeft: number;
  playerWidth: number;
  playerHeight: number;
  playerBottom: number;
  viewportHeight: number;
  keyboardInset: number;
};

export type MobileVideoGeometryCssVars = {
  headerBottom: string;
  left: string;
  width: string;
  height: string;
  bottom: string;
  vvh: string;
  keyboardInset: string;
};

export function px(value: number): string {
  const normalized = Math.round(Math.max(0, value) * 100) / 100;
  return `${normalized}px`;
}

export function computeMobileVideoGeometry(
  input: MobileVideoGeometryInput,
  frozenPlayerSize?: { playerWidth: number; playerHeight: number } | null,
): MobileVideoGeometryMetrics {
  const viewportBottom = input.viewportTop + input.viewportHeight;
  const effectiveHeaderBottom = Math.max(input.viewportTop, input.headerBottom);
  const availableHeight = Math.max(0, viewportBottom - effectiveHeaderBottom);
  const maxConstrainedPlayerHeight = Math.max(
    0,
    availableHeight - LANDSCAPE_MIN_CONTENT_HEIGHT_PX,
  );
  const widthFromAvailableHeight =
    maxConstrainedPlayerHeight * VIDEO_ASPECT_RATIO;

  const keyboardInset = Math.max(
    0,
    input.windowInnerHeight - input.viewportHeight - input.viewportTop,
  );
  const isLandscape = input.viewportWidth > input.viewportHeight;

  let playerWidth: number;
  let playerHeight: number;

  if (keyboardInset > 0 && frozenPlayerSize) {
    playerWidth = frozenPlayerSize.playerWidth;
    playerHeight = frozenPlayerSize.playerHeight;
  } else if (keyboardInset > 0) {
    const withoutKeyboard = computeMobileVideoGeometry(
      {
        ...input,
        windowInnerHeight: input.viewportHeight + input.viewportTop,
      },
      null,
    );
    playerWidth = withoutKeyboard.playerWidth;
    playerHeight = withoutKeyboard.playerHeight;
  } else {
    const constrainByHeight = isLandscape;
    playerWidth = constrainByHeight
      ? Math.min(
          input.viewportWidth,
          Math.max(1, widthFromAvailableHeight),
        )
      : input.viewportWidth;
    playerHeight = playerWidth / VIDEO_ASPECT_RATIO;
  }

  const playerLeft =
    input.viewportLeft +
    Math.max(0, (input.viewportWidth - playerWidth) / 2);

  return {
    effectiveHeaderBottom,
    playerLeft,
    playerWidth,
    playerHeight,
    playerBottom: effectiveHeaderBottom + playerHeight,
    viewportHeight: input.viewportHeight,
    keyboardInset,
  };
}

export function metricsToCssVars(
  metrics: MobileVideoGeometryMetrics,
): MobileVideoGeometryCssVars {
  return {
    headerBottom: px(metrics.effectiveHeaderBottom),
    left: px(metrics.playerLeft),
    width: px(metrics.playerWidth),
    height: px(metrics.playerHeight),
    bottom: px(metrics.playerBottom),
    vvh: px(metrics.viewportHeight),
    keyboardInset: px(metrics.keyboardInset),
  };
}

const CSS_VAR_NAMES = {
  headerBottom: "--fn-header-bottom",
  left: "--fn-mobile-player-left",
  width: "--fn-mobile-player-width",
  height: "--fn-mobile-player-height",
  bottom: "--fn-mobile-player-bottom",
  vvh: "--fn-visual-viewport-height",
  keyboardInset: "--fn-keyboard-inset",
} as const satisfies Record<
  keyof MobileVideoGeometryCssVars,
  string
>;

export function applyMobileVideoGeometryCssVars(
  root: HTMLElement,
  vars: MobileVideoGeometryCssVars,
  previous: MobileVideoGeometryCssVars | null,
): void {
  for (const key of Object.keys(CSS_VAR_NAMES) as Array<
    keyof MobileVideoGeometryCssVars
  >) {
    const value = vars[key];
    if (previous?.[key] === value) {
      continue;
    }

    root.style.setProperty(CSS_VAR_NAMES[key], value);
  }
}

export function clearMobileVideoGeometryCssVars(root: HTMLElement): void {
  for (const name of Object.values(CSS_VAR_NAMES)) {
    root.style.removeProperty(name);
  }
}
