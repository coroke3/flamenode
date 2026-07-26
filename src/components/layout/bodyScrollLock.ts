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

let state:
  | StoredBodyState
  | null = null;

export function
acquireBodyScrollLock():
  () => void {
  if (
    typeof window ===
      "undefined" ||
    typeof document ===
      "undefined"
  ) {
    return () => {};
  }

  const body = document.body;

  if (!state) {
    const scrollX =
      window.scrollX;
    const scrollY =
      window.scrollY;

    const scrollbarWidth =
      Math.max(
        0,
        window.innerWidth -
          document
            .documentElement
            .clientWidth,
      );

    const computedPadding =
      Number.parseFloat(
        window
          .getComputedStyle(body)
          .paddingRight,
      ) || 0;

    state = {
      count: 0,
      scrollX,
      scrollY,
      styles: {
        position:
          body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        overflow:
          body.style.overflow,
        paddingRight:
          body.style.paddingRight,
      },
    };

    body.style.position =
      "fixed";
    body.style.top =
      `-${scrollY}px`;
    body.style.left =
      `-${scrollX}px`;
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow =
      "hidden";

    if (scrollbarWidth > 0) {
      body.style.paddingRight =
        `${
          computedPadding +
          scrollbarWidth
        }px`;
    }
  }

  state.count += 1;
  let released = false;

  return () => {
    if (
      released ||
      !state
    ) {
      return;
    }

    released = true;
    state.count -= 1;

    if (state.count > 0) {
      return;
    }

    const snapshot = state;
    state = null;

    body.style.position =
      snapshot.styles.position;
    body.style.top =
      snapshot.styles.top;
    body.style.left =
      snapshot.styles.left;
    body.style.right =
      snapshot.styles.right;
    body.style.width =
      snapshot.styles.width;
    body.style.overflow =
      snapshot.styles.overflow;
    body.style.paddingRight =
      snapshot.styles.paddingRight;

    window.scrollTo(
      snapshot.scrollX,
      snapshot.scrollY,
    );
  };
}

export function
getBodyScrollLockCountForTest():
  number {
  return state?.count ?? 0;
}
