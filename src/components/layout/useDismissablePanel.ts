"use client";

import * as React from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useDismissablePanel(args: {
  open: boolean;
  onClose: () => void;
  panelRef:
    React.RefObject<HTMLElement | null>;
  triggerRef:
    React.RefObject<HTMLElement | null>;
  routeKey: string;
  lockBody?: boolean;
}): void {
  const {
    open,
    onClose,
    panelRef,
    triggerRef,
    routeKey,
    lockBody = false,
  } = args;

  const previousRouteRef =
    React.useRef(routeKey);

  React.useEffect(() => {
    if (
      previousRouteRef.current !==
      routeKey
    ) {
      previousRouteRef.current =
        routeKey;
      onClose();
    }
  }, [routeKey, onClose]);

  React.useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    const previousOverflow =
      document.body.style.overflow;

    if (lockBody) {
      document.body.style.overflow =
        "hidden";
    }

    const onPointerDown = (
      event: PointerEvent,
    ) => {
      const target =
        event.target as Node;

      if (
        panel?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }

      onClose();
    };

    const onKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        triggerRef.current?.focus();
        return;
      }

      if (
        event.key !== "Tab" ||
        !panel
      ) {
        return;
      }

      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          FOCUSABLE,
        ),
      ].filter(
        (element) =>
          !element.hasAttribute("disabled") &&
          element.offsetParent !== null,
      );

      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last =
        focusable[focusable.length - 1];

      if (
        event.shiftKey &&
        document.activeElement === first
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === last
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener(
      "pointerdown",
      onPointerDown,
    );
    window.addEventListener(
      "keydown",
      onKeyDown,
    );

    queueMicrotask(() => {
      panel
        ?.querySelector<HTMLElement>(
          FOCUSABLE,
        )
        ?.focus();
    });

    return () => {
      window.removeEventListener(
        "pointerdown",
        onPointerDown,
      );
      window.removeEventListener(
        "keydown",
        onKeyDown,
      );

      if (lockBody) {
        document.body.style.overflow =
          previousOverflow;
      }
    };
  }, [
    open,
    onClose,
    panelRef,
    triggerRef,
    lockBody,
  ]);
}
