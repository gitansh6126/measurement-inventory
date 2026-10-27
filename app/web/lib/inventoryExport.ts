import { api } from "./api";
import type { InventoryList, StockProduct } from "./types";

const PAGE_SIZE = 200;
const CONCURRENT_PAGES = 4;

/** Reads the complete filtered result in small pages so large exports do not hit the unpaged cap. */
export async function fetchAllInventory(
  params: URLSearchParams,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<StockProduct[]> {
  const pageParams = new URLSearchParams(params);
  pageParams.set("page", "1");
  pageParams.set("pageSize", String(PAGE_SIZE));
  const first = await api<InventoryList>(`/inventory?${pageParams}`, { signal });
  const products = [...first.products];
  const pageCount = Math.ceil(first.total / PAGE_SIZE);
  onProgress?.(products.length, first.total);

  for (let start = 2; start <= pageCount; start += CONCURRENT_PAGES) {
    const pages = Array.from(
      { length: Math.min(CONCURRENT_PAGES, pageCount - start + 1) },
      (_, index) => start + index,
    );
    const batch = await Promise.all(
      pages.map((page) => {
        const query = new URLSearchParams(pageParams);
        query.set("page", String(page));
        return api<InventoryList>(`/inventory?${query}`, { signal });
      }),
    );
    for (const result of batch) products.push(...result.products);
    onProgress?.(products.length, first.total);
  }
  return products;
}
