/**
 * Write text to the clipboard without leaking browser permission errors to
 * event handlers. The Clipboard API can be unavailable or reject after a
 * permission prompt, so keep a DOM fallback for older browsers.
 */
export async function writeTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the selection-based fallback.
    }
  }

  if (typeof document === "undefined" || !document.body) return false;

  // The legacy copy fallback steals keyboard focus; preserve the trigger.
  const previouslyFocused = document.activeElement as HTMLElement | null;
  let textarea: HTMLTextAreaElement | null = null;
  try {
    textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    try {
      if (textarea) {
        if (typeof textarea.remove === "function") textarea.remove();
        else textarea.parentNode?.removeChild(textarea);
      }
    } finally {
      // A removed temporary textarea must not leave keyboard users unfocused.
      // Focus restoration is best-effort and must not change the copy result.
      try {
        previouslyFocused?.focus();
      } catch {
        // The original element may have been removed or become unfocusable.
      }
    }
  }
}
