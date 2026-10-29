/**
 * Utilities for form field validation, auto-scroll to invalid fields,
 * and visual error indicators (micro-shake + dual pulse ring).
 */

export function scrollToAndHighlightField(
  target: string | HTMLElement | null | undefined,
  options?: {
    focus?: boolean;
    durationMs?: number;
  }
) {
  if (typeof window === "undefined" || !target) return false;

  const el = typeof target === "string" ? document.getElementById(target) || document.querySelector(target) : target;
  if (!el || !(el instanceof HTMLElement)) return false;

  // 1. Smoothly center the element in viewport so it's not hidden behind sticky headers/footers
  el.scrollIntoView({ behavior: "smooth", block: "center" });

  // 2. Identify the input element to focus and highlight
  const isInputLike = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
  const inputEl = isInputLike
    ? el
    : el.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not([type='hidden']), textarea, select, [tabindex='0']") ?? el;

  // 3. Focus without jumping
  if (options?.focus !== false && typeof inputEl.focus === "function") {
    try {
      inputEl.focus({ preventScroll: true });
    } catch {
      // Ignore focus issues on non-interactive elements
    }
  }

  // 4. Trigger micro-shake & pulse animation (reflow trick to allow re-triggering)
  inputEl.classList.remove("field-error-highlight");
  // Force browser reflow so animation re-runs even if already errored
  void inputEl.offsetWidth;
  inputEl.classList.add("field-error-highlight");

  const duration = options?.durationMs ?? 2200;
  window.setTimeout(() => {
    inputEl.classList.remove("field-error-highlight");
  }, duration);

  return true;
}
