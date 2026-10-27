import {
  formatAttributeValue,
  formatVariationAttributes,
  formatVariationAttributesString,
  resolveAttrUnit,
  type UnitDefSource,
} from "@rs-v31/shared";

export {
  formatAttributeValue,
  formatVariationAttributes,
  formatVariationAttributesString,
  resolveAttrUnit,
  type UnitDefSource,
};

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("en-IN");

/** Indian currency grouping without adding trailing decimal zeroes. */
export const money = (v: string | number) => inr.format(Number(v));
export const qty = (n: number) => whole.format(n);

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Label for a variation: its attribute values with units, or fallback for empty attributes. */
export const variationLabel = (
  v: { attributes: Record<string, string>; shortName?: string },
  defsOrMap?: UnitDefSource
) => {
  const items = formatVariationAttributes(v.attributes, defsOrMap);
  if (items.length > 0) {
    return items.map((i) => i.formatted).join(" / ");
  }
  return v.shortName ?? "";
};
