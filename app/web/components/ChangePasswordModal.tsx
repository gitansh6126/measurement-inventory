"use client";

import { useState, type FormEvent } from "react";
import { Alert, Field, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import { errorText } from "@/lib/useApi";

/** Any signed-in user changes their own password (POST /api/auth/password, audit B06). Other sessions are signed out by the API. */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const currentPassword = String(f.get("current") ?? "");
    const newPassword = String(f.get("next") ?? "");
    if (newPassword.length < 10) return setError("New password must be at least 10 characters");
    if (newPassword !== String(f.get("confirm") ?? "")) return setError("The two new passwords do not match");
    setError("");
    setSaving(true);
    try {
      await api("/auth/password", { method: "POST", body: { currentPassword, newPassword } });
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  const close = () => {
    setError("");
    setDone(false);
    onClose();
  };

  return (
    <Modal open={open} title="Change password" onClose={close}>
      {done ? (
        <div className="grid gap-4">
          <Alert kind="success" message="Password changed. Other devices signed in with your account have been signed out." />
          <div className="flex justify-end">
            <button className="btn-primary" onClick={close}>Close</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Current password">
            <input className="input" name="current" type="password" required maxLength={200} autoComplete="current-password" />
          </Field>
          <Field label="New password (at least 10 characters)">
            <input className="input" name="next" type="password" required minLength={10} maxLength={200} autoComplete="new-password" />
          </Field>
          <Field label="Repeat new password">
            <input className="input" name="confirm" type="password" required maxLength={200} autoComplete="new-password" />
          </Field>
          <Alert message={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
            <button className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Change password"}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
