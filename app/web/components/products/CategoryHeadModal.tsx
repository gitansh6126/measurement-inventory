"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Alert, Field, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import type { CategoryHead } from "@/lib/types";
import { errorText } from "@/lib/useApi";

// V3.1: new / rename a category head (e.g. "Industry", "Material", "Brand"). Used on the
// Categories page and inside the product form.
export function CategoryHeadModal({
  open,
  head,
  initialName,
  onClose,
  onSaved,
}: {
  open: boolean;
  head: CategoryHead | null;
  initialName?: string;
  onClose: () => void;
  onSaved: (h: CategoryHead) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(head?.name ?? initialName ?? "");
    setError("");
    setSaving(false);
  }, [open, head, initialName]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    // Opened inside the product form: never let this submit reach it.
    e.stopPropagation();
    setSaving(true);
    try {
      const r = head
        ? await api<{ head: CategoryHead }>(`/category-heads/${head.id}`, { method: "PATCH", body: { name } })
        : await api<{ head: CategoryHead }>("/category-heads", { method: "POST", body: { name } });
      onSaved(r.head);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title={head ? "Rename Category Head" : "New Category Head"} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Head Name *">
          <input autoComplete="off" className="input" required maxLength={60} placeholder="e.g. Industry" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        {!head && (
          <p className="text-xs text-slate-500">
            A head is another way to group products, next to Product Type. Under it you add categories (Industry → Agriculture, Gym, Marine), and a product can be in any number of them.
          </p>
        )}
        <Alert message={error} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving}>{saving ? "Saving…" : head ? "Rename" : "Create Head"}</button>
        </div>
      </form>
    </Modal>
  );
}
