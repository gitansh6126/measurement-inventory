// Absolute (forward-slash) globs so scanning works regardless of the dev server's cwd (pattern from marble 2110).
const path = require("path");
const root = __dirname.split(path.sep).join("/");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [`${root}/app/**/*.{ts,tsx}`, `${root}/components/**/*.{ts,tsx}`, `${root}/lib/**/*.{ts,tsx}`],
  theme: {
    extend: {
      // Brand palette and "tall" screen from marble 2110 tailwind.config.js (D23).
      screens: { tall: { raw: "(min-width: 1024px) and (min-height: 700px)" } },
      // Bottom-sheet drawer: slide up from the bottom on open, back down on close; backdrop fades.
      keyframes: {
        "sheet-in": { from: { transform: "translateY(100%)" }, to: { transform: "translateY(0)" } },
        "sheet-out": { from: { transform: "translateY(0)" }, to: { transform: "translateY(100%)" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "fade-out": { from: { opacity: "1" }, to: { opacity: "0" } },
      },
      animation: {
        "sheet-in": "sheet-in 280ms cubic-bezier(0.32, 0.72, 0, 1) both",
        "sheet-out": "sheet-out 200ms cubic-bezier(0.4, 0, 1, 1) both",
        "fade-in": "fade-in 200ms ease-out both",
        "fade-out": "fade-out 200ms ease-in both",
      },
      colors: {
        brand: { 50: "#fff7ed", 100: "#ffedd5", 200: "#fed7aa", 300: "#fdba74", 400: "#fb923c", 500: "#f97316", 600: "#ea580c", 700: "#c2410c", 800: "#9a3412", 900: "#7c2d12" },
      },
    },
  },
  plugins: [],
};
