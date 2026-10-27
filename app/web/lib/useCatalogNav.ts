"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePreference } from "@/lib/usePreference";

export const ALL_CATEGORIES = "all";

function withParams(
  pathname: string,
  current: URLSearchParams,
  updates: Record<string, string | null>,
) {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** URL-backed category and search for the cart catalog; products open in ProductDrawer. */
export function useCatalogNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const lastCategory = usePreference<string>("cart.last-category", ALL_CATEGORIES);
  const categoryParam = params.get("cat");
  const query = params.get("q") ?? "";

  useEffect(() => {
    if (categoryParam !== null || !lastCategory.ready) return;
    router.replace(withParams(pathname, new URLSearchParams(params.toString()), {
      cat: lastCategory.value || ALL_CATEGORIES,
    }));
  }, [categoryParam, lastCategory.ready, lastCategory.value, params, pathname, router]);

  const selectCategory = useCallback(
    (category: string) => {
      void lastCategory.save(category);
      router.replace(withParams(pathname, new URLSearchParams(params.toString()), {
        cat: category,
        product: null,
      }));
    },
    [lastCategory.save, params, pathname, router],
  );

  const setQuery = useCallback(
    (value: string) => {
      router.replace(withParams(pathname, new URLSearchParams(params.toString()), {
        q: value.trim() || null,
        product: null,
      }));
    },
    [params, pathname, router],
  );

  return {
    category: categoryParam ?? (lastCategory.ready ? lastCategory.value : ALL_CATEGORIES),
    query,
    selectCategory,
    setQuery,
  };
}
