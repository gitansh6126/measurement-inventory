/**
 * Scroll the first element found among `ids` to the middle of the screen. Tried twice
 * (100 ms, 300 ms) because lists and images may still be laying out. Returns the
 * effect cleanup.
 */
export function scrollToFocus(...ids: string[]) {
  const scroll = () => {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) return el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };
  const t1 = setTimeout(scroll, 100);
  const t2 = setTimeout(scroll, 300);
  return () => {
    clearTimeout(t1);
    clearTimeout(t2);
  };
}
