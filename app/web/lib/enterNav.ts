/**
 * Enter moves to the next field, everywhere in the app (owner 2026-10-30), like Tally / Busy:
 * Enter = next field, Shift+Enter = previous field, Ctrl+Enter = save the form.
 *
 * One window listener (installed by <EnterKeyNavigation/> in the root layout) instead of an
 * onKeyDown on every input. It runs after React's own handlers, so any component that handles
 * Enter itself (a dropdown picking its highlighted row, a quantity box that adds to cart, a
 * length field with onEnter) calls preventDefault and is left alone.
 *
 * - Fields: input (not file / hidden), select, textarea and role="combobox". In a textarea Enter
 *   moves on only while it is empty; once text is typed Enter is a new line (Tab / Ctrl+Enter to
 *   leave). Buttons keep Enter (it presses them).
 * - Scope: the closest [data-enter-scope], else the <form>, else the open dialog, else the page.
 * - In a form, Enter on the last field focuses its submit button (Enter again saves), so a
 *   half-filled form or a barcode scanner's trailing Enter never saves by accident.
 *   <form data-enter-last="submit"> saves straight away instead (login).
 *   In a dialog or [data-enter-scope] without a form, the last field focuses its last main
 *   (.btn-primary) button, e.g. a wizard step's Continue or a dialog's Save.
 * - Opt out: data-enter="off" on a field or any ancestor (search boxes keep their own Enter).
 *   data-enter="skip" on a field leaves it out of the order.
 */

const FIELDS = [
  'input:not([type="hidden"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"])',
  "select",
  "textarea",
  '[role="combobox"]',
].join(",");

const isField = (el: Element) => el.matches(FIELDS) && el.tagName !== "BUTTON";

function usable(el: HTMLElement) {
  if ((el as HTMLInputElement).disabled || el.matches("[readonly]") || el.tabIndex < 0) return false;
  if (el.closest('[data-enter="skip"],[aria-hidden="true"],[inert]')) return false;
  // Hidden by CSS (display:none, collapsed sections): no layout box.
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
}

function scopeOf(el: HTMLElement): HTMLElement {
  return (
    el.closest<HTMLElement>("[data-enter-scope]") ??
    el.closest<HTMLElement>("form") ??
    el.closest<HTMLElement>('[role="dialog"]') ??
    document.querySelector<HTMLElement>("main") ??
    document.body
  );
}

function submitButtonOf(form: HTMLFormElement) {
  return Array.from(form.querySelectorAll<HTMLButtonElement>('button[type="submit"],button:not([type])')).find(
    (b) => !b.disabled && b.getClientRects().length > 0
  );
}

function focusField(el: HTMLElement) {
  el.focus();
  // Typing replaces the old value, as in Tally (combobox inputs show the label, not a query).
  if (el instanceof HTMLInputElement && el.getAttribute("role") !== "combobox") {
    try {
      el.select();
    } catch {
      /* types without a text selection (e.g. date in some browsers) */
    }
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== "Enter" || e.defaultPrevented || e.isComposing || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (!t || !(t instanceof HTMLElement) || t.closest('[data-enter="off"]')) return;
  const form = t.closest("form");

  // Ctrl+Enter: save the form from any field, textarea included.
  if (e.ctrlKey || e.metaKey) {
    if (form && isField(t)) {
      e.preventDefault();
      form.requestSubmit(submitButtonOf(form));
    }
    return;
  }
  if (t.isContentEditable || !isField(t)) return;
  if (t instanceof HTMLTextAreaElement && t.value !== "") return;
  if (t instanceof HTMLInputElement && t.type === "search") return;

  const scope = scopeOf(t);
  const list = Array.from(scope.querySelectorAll<HTMLElement>(FIELDS)).filter((el) => el === t || usable(el));
  const i = list.indexOf(t);
  if (i < 0) return;
  e.preventDefault(); // no implicit form submit

  if (e.shiftKey) {
    const prev = list[i - 1];
    if (prev) focusField(prev);
    return;
  }
  const next = list[i + 1];
  if (next) return focusField(next);

  // Last field.
  if (form && scope === form) {
    if (form.dataset.enterLast === "submit") return form.requestSubmit(submitButtonOf(form));
    const btn = submitButtonOf(form);
    btn?.focus();
    btn?.scrollIntoView({ block: "nearest" });
  } else if (scope.matches('[role="dialog"],[data-enter-scope]')) {
    const btn = Array.from(scope.querySelectorAll<HTMLButtonElement>(".btn-primary")).filter((b) => !b.disabled && b.getClientRects().length > 0).at(-1);
    btn?.focus();
  }
}

/** Installs the app-wide handler; returns the cleanup. */
export function installEnterNavigation() {
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
