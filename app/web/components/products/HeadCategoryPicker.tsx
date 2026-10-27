"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Combobox } from "@/components/Combobox";
import { useCan } from "@/components/MeContext";
import { MultiCombobox } from "@/components/MultiCombobox";
import { api } from "@/lib/api";
import type { Category, CategoryHead, HeadCategory } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { CategoryModal } from "./CategoryModal";
import { VariationScopePicker, type ScopeVariation } from "./VariationScopePicker";

/**
 * V3.1 category heads on the product form: one searchable multi-select dropdown per head other
 * than Product Type (e.g. Industry: Agriculture, Gym). A product may be in any number of them.
 * Typing a name that does not exist offers to create it (the category popup opens with the name
 * filled in, so an image can be added); a last dropdown creates a new head.
 * Inactive categories already on the product stay listed so they can be removed.
 * V3.1 (0038): with `variations` (Variable / Measured), each ticked category applies to all
 * variations or only some (`scopes`, see VariationScopePicker).
 */
export function HeadCategoryPicker({
  value,
  onChange,
  current = [],
  variations,
  scopes = {},
  onScopesChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  current?: HeadCategory[];
  variations?: ScopeVariation[];
  scopes?: Record<string, string[]>;
  onScopesChange?: (next: Record<string, string[]>) => void;
}) {
  const canCreate = useCan("category.write");
  const heads = useApi<{ heads: CategoryHead[] }>("/category-heads");
  const cats = useApi<{ categories: Category[] }>("/categories?headId=all");
  const [creating, setCreating] = useState<{ head: { id: string; name: string }; name: string } | null>(null);
  const [note, setNote] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  if (!heads.data || !cats.data) return null;
  const others = heads.data.heads.filter((h): h is CategoryHead & { id: string } => !h.builtIn && !!h.id);
  const selected = new Set(value);

  async function createHead(name: string) {
    setNote(null);
    try {
      const { head } = await api<{ head: CategoryHead }>("/category-heads", { method: "POST", body: { name } });
      await heads.reload();
      setNote({ kind: "success", text: `“${head.name}” was added as a new category head. Pick or type its categories in the ${head.name} dropdown.` });
    } catch (e) {
      setNote({ kind: "error", text: errorText(e) });
    }
  }

  return (
    <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
      {others.map((h) => {
        const list = (cats.data?.categories ?? []).filter((c) => c.headId === h.id && (c.active || selected.has(c.id)));
        const retired = current.filter((c) => c.headId === h.id && selected.has(c.id) && !list.some((l) => l.id === c.id));
        const options = [
          ...list.map((c) => ({ id: c.id, label: c.name, sublabel: c.active ? `${c.productCount} products` : "inactive" })),
          ...retired.map((c) => ({ id: c.id, label: c.name, sublabel: "inactive" })),
        ];
        const ids = new Set(options.map((o) => o.id));
        return (
          <div key={h.id}>
            <span className="label">{h.name}</span>
            <MultiCombobox
              ariaLabel={h.name}
              values={value.filter((id) => ids.has(id))}
              options={options}
              onChange={(next) => onChange([...value.filter((id) => !ids.has(id)), ...next])}
              onCreate={canCreate ? (q) => setCreating({ head: { id: h.id, name: h.name }, name: q }) : undefined}
              createLabel={(q) => `Add “${q}” as a new ${h.name} category`}
              placeholder={options.length ? `Select ${h.name.toLowerCase()} categories…` : canCreate ? `Type to add the first ${h.name} category` : `No ${h.name} categories yet`}
              emptyText={canCreate ? "No match — keep typing to add it" : "No matches"}
            />
          </div>
        );
      })}

      {variations && onScopesChange && (
        <VariationScopePicker
          variations={variations}
          scopes={scopes}
          onChange={onScopesChange}
          categories={value.flatMap((id) => {
            const c = cats.data?.categories.find((x) => x.id === id) ?? current.find((x) => x.id === id);
            const head = others.find((h) => h.id === c?.headId);
            return c && head ? [{ id, name: c.name, headName: head.name }] : [];
          })}
        />
      )}

      {canCreate && (
        <div>
          <span className="label">New category head</span>
          <Combobox
            value={null}
            options={[]}
            onSelect={() => undefined}
            onCreate={(q) => void createHead(q)}
            createLabel={(q) => `Create new head “${q}”`}
            placeholder={others.length ? "Type a head name, e.g. Material" : "Type a head name, e.g. Industry"}
            emptyText="Type a name to create a head (e.g. Industry, Material, Brand)"
          />
        </div>
      )}

      {note && (
        <p className={`text-xs sm:col-span-2 ${note.kind === "success" ? "text-emerald-700" : "text-rose-600"}`} role="status">
          {note.text}
        </p>
      )}

      {/* Portalled: the product form must not contain this popup's own form. */}
      {typeof document !== "undefined" &&
        createPortal(
          <CategoryModal
            open={!!creating}
            category={null}
            head={creating?.head}
            initialName={creating?.name}
            onClose={() => setCreating(null)}
            onSaved={(c) => {
              const head = creating?.head.name ?? "";
              setCreating(null);
              onChange([...value, c.id]);
              void cats.reload();
              setNote({ kind: "success", text: `“${c.name}” was added as a new category under ${head} and selected for this product.` });
            }}
          />,
          document.body,
        )}
    </div>
  );
}
