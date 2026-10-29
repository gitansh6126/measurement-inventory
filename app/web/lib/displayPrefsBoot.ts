// Server-safe part of lib/displayPrefs.ts (the root layout is a Server Component and cannot import hooks).
export const DISPLAY_PREFS_KEY = "ui.display_prefs";

/** Inline <head> script: applies the saved preferences before first paint, so the page does not jump. */
export const DISPLAY_PREFS_BOOT = `try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(DISPLAY_PREFS_KEY)})||"null");if(p){var s=document.documentElement.style;if(p.text)s.setProperty("--ui-text",p.text);if(p.space)s.setProperty("--ui-space",p.space);s.removeProperty("--ui-page-w")}}catch(e){}`;
