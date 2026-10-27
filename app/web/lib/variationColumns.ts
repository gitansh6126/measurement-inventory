import type { AttributeDef } from "@/lib/types";

export interface VariationAttributeColumn {
  name: string;
  unit?: string;
}

/**
 * Derives ordered attribute columns for a product's variation sub-table.
 * Starts with declared attribute definitions, then appends any extra keys present on variations.
 */
export function variationAttributeColumns(
  product: { attributes?: AttributeDef[] },
  variations: Array<{ attributes: Record<string, string> }>
): VariationAttributeColumn[] {
  const defs = product.attributes ?? [];
  const names = defs.map((d) => d.name);
  for (const v of variations) {
    for (const k of Object.keys(v.attributes || {})) {
      if (!names.includes(k)) names.push(k);
    }
  }
  return names.map((n) => ({
    name: n,
    unit: defs.find((d) => d.name === n && !d.isQuality)?.unit || undefined,
  }));
}
