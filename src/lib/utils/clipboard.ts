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
    if (textarea) {
      if (typeof textarea.remove === "function") textarea.remove();
      else textarea.parentNode?.removeChild(textarea);
    }
  }
}
