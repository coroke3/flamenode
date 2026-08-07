export type FloatingMenuPlacement = "bottom-end" | "top-end";

export type FloatingMenuRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type FloatingMenuSize = {
  width: number;
  height: number;
};

export type FloatingMenuViewport = {
  width: number;
  height: number;
};

export type FloatingMenuPositionInput = {
  anchor: FloatingMenuRect;
  menu: FloatingMenuSize;
  viewport: FloatingMenuViewport;
  gap?: number;
  margin?: number;
};

export type FloatingMenuPosition = {
  top: number;
  left: number;
  placement: FloatingMenuPlacement;
};

/**
 * 右揃えドロップダウンの viewport 配置。
 * 下に収まらなければ上へ flip、左右は margin 内へ clamp。
 */
export function computeFloatingMenuPosition(
  input: FloatingMenuPositionInput,
): FloatingMenuPosition {
  const gap = input.gap ?? 6;
  const margin = input.margin ?? 8;
  const { anchor, menu, viewport } = input;

  const spaceBelow = viewport.height - (anchor.top + anchor.height) - margin;
  const spaceAbove = anchor.top - margin;
  const preferBottom =
    menu.height + gap <= spaceBelow || spaceBelow >= spaceAbove;

  let top = preferBottom
    ? anchor.top + anchor.height + gap
    : anchor.top - menu.height - gap;
  let placement: FloatingMenuPlacement = preferBottom ? "bottom-end" : "top-end";

  const maxTop = Math.max(margin, viewport.height - menu.height - margin);
  top = Math.min(Math.max(top, margin), maxTop);

  let left = anchor.left + anchor.width - menu.width;
  const maxLeft = Math.max(margin, viewport.width - menu.width - margin);
  left = Math.min(Math.max(left, margin), maxLeft);

  return { top, left, placement };
}
