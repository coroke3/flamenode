/**
 * Body scroll lock primitive (MIG-0202).
 * Locks body scrolling when modals/drawers are open, preserving scroll position.
 * Pure DOM implementation, zero framework dependencies.
 */
type StoredBodyState = {
  count: number;
  scrollX: number;
  scrollY: number;
  styles: {
    position: string;
    top: string;
    left: string;
    right: string;
    width: string;
    overflow: string;
    paddingRight: string;
  };
};

// Kept on globalThis so every copy of this module (the source imported by the Next
// app through its bridge, and the `@flamenode/ui` dist build) shares one lock.
const STATE_KEY = Symbol.for("flamenode.bodyScrollLock");
type LockHolder = { [STATE_KEY]?: StoredBodyState | null };
const holder = globalThis as LockHolder;

export function acquireBodyScrollLock(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const body = document.body;

  let state = holder[STATE_KEY] ?? null;
  if (!state) {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    const scrollbarWidth = Math.max(
      0,
      window.innerWidth - document.documentElement.clientWidth,
    );

    const computedPadding =
      Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;

    state = {
      count: 0,
      scrollX,
      scrollY,
      styles: {
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        overflow: body.style.overflow,
        paddingRight: body.style.paddingRight,
      },
    };
    holder[STATE_KEY] = state;

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = `-${scrollX}px`;
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";

    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${computedPadding + scrollbarWidth}px`;
    }
  }

  state.count += 1;
  const lock = state;
  let released = false;

  return () => {
    if (released || holder[STATE_KEY] !== lock) {
      return;
    }

    released = true;
    lock.count -= 1;

    if (lock.count > 0) {
      return;
    }

    const snapshot = lock;
    holder[STATE_KEY] = null;

    body.style.position = snapshot.styles.position;
    body.style.top = snapshot.styles.top;
    body.style.left = snapshot.styles.left;
    body.style.right = snapshot.styles.right;
    body.style.width = snapshot.styles.width;
    body.style.overflow = snapshot.styles.overflow;
    body.style.paddingRight = snapshot.styles.paddingRight;

    window.scrollTo({
      left: snapshot.scrollX,
      top: snapshot.scrollY,
      behavior: "instant",
    });
  };
}

export function getBodyScrollLockCountForTest(): number {
  return holder[STATE_KEY]?.count ?? 0;
}
