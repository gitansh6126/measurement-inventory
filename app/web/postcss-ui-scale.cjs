// Display preferences (owner request 2026-10-28): text size and spacing are user-adjustable, so every
// font-size / line-height in the built CSS is multiplied by var(--ui-text) and every padding /
// margin / gap by var(--ui-space). Both default to 1 (identical to before) and are set on <html> by
// lib/displayPrefs.ts. Width/height are left alone so the sidebar and fixed layouts keep their size.
// Done here rather than in tailwind.config so arbitrary classes like text-[11px] scale too.
const LENGTH = /(-?\d*\.?\d+)(rem|px|em)\b/g;
const TEXT_PROPS = /^(font-size|line-height)$/;
const SPACE_PROPS = /^(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/;

const scale = (value, factor) =>
  value.replace(LENGTH, (m, num, unit) => {
    // Hairlines (1px offsets, 0) stay exact.
    if (unit === "px" && Math.abs(parseFloat(num)) <= 1) return m;
    if (parseFloat(num) === 0) return m;
    return `calc(${m} * var(${factor}, 1))`;
  });

module.exports = () => ({
  postcssPlugin: "ui-scale",
  Declaration(decl) {
    if (decl.value.includes("--ui-")) return;
    if (TEXT_PROPS.test(decl.prop)) decl.value = scale(decl.value, "--ui-text");
    else if (SPACE_PROPS.test(decl.prop)) decl.value = scale(decl.value, "--ui-space");
  },
});
module.exports.postcss = true;
