/**
 * Submit a form across browsers with and without HTMLFormElement.requestSubmit.
 *
 * requestSubmit() performs native constraint validation before dispatching the
 * submit event. Older Safari builds do not expose it, so the fallback must
 * preserve that validation before dispatching the same cancelable event.
 */
export function submitFormCompat(form: HTMLFormElement): void {
  const requestSubmit = form.requestSubmit;
  if (typeof requestSubmit === "function") {
    requestSubmit.call(form);
    return;
  }

  if (
    !form.noValidate &&
    typeof form.checkValidity === "function" &&
    !form.checkValidity()
  ) {
    form.reportValidity?.();
    return;
  }

  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
