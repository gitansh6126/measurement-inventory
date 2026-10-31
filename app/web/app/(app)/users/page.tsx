"use client";

import { useState, type FormEvent } from "react";
import { ChangePasswordModal } from "@/components/ChangePasswordModal";
import { EditIcon, KeyIcon, PlusIcon, UsersIcon } from "@/components/icons";
import { useCan, useMe } from "@/components/MeContext";
import { Alert, EmptyState, Field, Modal, PageHeader, Switch, TableSkeleton } from "@/components/ui";
import { api, type Role } from "@/lib/api";
import { errorText, useApi } from "@/lib/useApi";

// Admin user management (audit B06) on the existing /api/users endpoints. There is no public
// sign-up: the first admin comes from `npm run create-admin`, everyone else is added here.
// The API keeps at least one active admin and signs a user out when deactivated or reset.

interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
}

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "admin", label: "Admin", hint: "Everything, including users and archiving" },
  { value: "sales_manager", label: "Sales manager", hint: "Products, stock, prices, sales and purchases" },
  { value: "sales_staff", label: "Sales staff", hint: "Sales and customers only" },
];
const roleLabel = (r: Role) => ROLES.find((x) => x.value === r)?.label ?? r;

export default function UsersPage() {
  const canManage = useCan("user.manage");
  if (!canManage) {
    return <SelfUserAccount />;
  }
  return <Users />;
}

function SelfUserAccount() {
  const me = useMe();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  if (!me) return null;

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="My Account"
        subtitle="Manage your profile and credentials"
      />
      <div className="card space-y-6 p-6">
        <div className="flex items-center gap-4 border-b border-slate-100 pb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-base font-bold text-brand-700">
            {me.user.name[0]?.toUpperCase()}
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">{me.user.name}</h2>
            <p className="text-xs text-slate-500">{me.user.email}</p>
            <span className="mt-1 inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase text-slate-600">
              {roleLabel(me.user.role)}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Password</h3>
            <p className="text-xs text-slate-500">Change your account password securely.</p>
          </div>
          <button type="button" className="btn-primary" onClick={() => setChangePasswordOpen(true)}>
            <KeyIcon className="h-4 w-4" /> Change password
          </button>
        </div>
      </div>
      <ChangePasswordModal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </div>
  );
}

function Users() {
  const me = useMe();
  const { data, error, reload } = useApi<{ users: User[] }>("/users");
  const [modal, setModal] = useState<{ user: User | null } | null>(null);
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  async function setActive(u: User, active: boolean) {
    setFlash(null);
    try {
      await api(`/users/${u.id}`, { method: "PATCH", body: { active } });
      setFlash({ kind: "success", text: `${u.name} ${active ? "activated" : "deactivated and signed out"}` });
      await reload();
    } catch (e) {
      setFlash({ kind: "error", text: errorText(e) });
    }
  }

  const users = data?.users ?? [];
  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={data ? `${users.filter((u) => u.active).length} active of ${users.length}` : undefined}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setChangePasswordOpen(true)}
            >
              <KeyIcon className="h-4 w-4" /> Change Password
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setModal({ user: null })}
            >
              <PlusIcon className="h-4 w-4" /> Add User
            </button>
          </div>
        }
      />
      <Alert message={flash?.text} kind={flash?.kind} />
      <Alert message={error} />

      <div className="card overflow-x-auto lg:overflow-x-visible">
        {!data && !error ? (
          <TableSkeleton />
        ) : users.length === 0 ? (
          <EmptyState icon={<UsersIcon className="h-6 w-6" />} title="No users" />
        ) : (
          <table className="table table-stack">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th className="w-40 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.active ? "" : "opacity-60"}>
                  <td className="font-medium text-slate-900">
                    {u.name}
                    {u.id === me?.user.id && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                  </td>
                  <td>{u.email}</td>
                  <td>{roleLabel(u.role)}</td>
                  <td>
                    <Switch checked={u.active} label={u.active ? "Active" : "Inactive"} disabled={u.id === me?.user.id} onChange={(on) => setActive(u, on)} />
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      {u.id === me?.user.id && (
                        <button
                          type="button"
                          className="flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-brand-600"
                          title="Change my password"
                          onClick={() => setChangePasswordOpen(true)}
                        >
                          <KeyIcon className="h-3.5 w-3.5 text-slate-400" />
                          <span>Change password</span>
                        </button>
                      )}
                      <button className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" title="Edit" aria-label={`Edit ${u.name}`} onClick={() => setModal({ user: u })}>
                        <EditIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <UserModal
        open={!!modal}
        user={modal?.user ?? null}
        isSelf={!!modal?.user && modal.user.id === me?.user.id}
        onClose={() => setModal(null)}
        onOpenChangePassword={() => {
          setModal(null);
          setChangePasswordOpen(true);
        }}
        onSaved={(text) => {
          setModal(null);
          setFlash({ kind: "success", text });
          void reload();
        }}
      />

      <ChangePasswordModal
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />
    </div>
  );
}

function UserModal({
  open,
  user,
  isSelf,
  onClose,
  onOpenChangePassword,
  onSaved,
}: {
  open: boolean;
  user: User | null;
  isSelf: boolean;
  onClose: () => void;
  onOpenChangePassword?: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = !!user;
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    const role = String(f.get("role") ?? "") as Role;
    const password = String(f.get("password") ?? "");
    if (password && password.length < 10) return setError("Password must be at least 10 characters");
    if (password && password !== String(f.get("confirm") ?? "")) return setError("The two passwords do not match");
    setError("");
    setSaving(true);
    try {
      if (!isEdit) {
        await api("/users", { method: "POST", body: { name, email: String(f.get("email") ?? "").trim(), role, password } });
        onSaved(`${name} added`);
      } else {
        const body: Record<string, unknown> = {};
        if (name !== user!.name) body.name = name;
        if (role !== user!.role) body.role = role;
        if (password) body.password = password;
        if (!Object.keys(body).length) return onClose();
        await api(`/users/${user!.id}`, { method: "PATCH", body });
        onSaved(password ? `${name} saved; password reset and existing sessions signed out` : `${name} saved`);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title={isEdit ? `Edit ${user!.name}` : "Add User"} onClose={onClose}>
      {/* key remounts the form so fields reset for each user */}
      <form key={user?.id ?? "new"} onSubmit={submit} className="grid gap-4">
        <Field label="Name">
          <input className="input" name="name" required maxLength={120} defaultValue={user?.name ?? ""} />
        </Field>
        <Field label="Email (sign-in)">
          <input className="input" name="email" type="email" required maxLength={200} defaultValue={user?.email ?? ""} disabled={isEdit} autoComplete="off" />
        </Field>
        <Field label="Role">
          <select className="input" name="role" defaultValue={user?.role ?? "sales_staff"} disabled={isSelf}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label} — {r.hint}</option>
            ))}
          </select>
          {isSelf && <input type="hidden" name="role" value={user!.role} />}
        </Field>
        <Field label={isEdit ? "New password (leave blank to keep)" : "Password (at least 10 characters)"}>
          <input className="input" name="password" type="password" minLength={10} maxLength={200} required={!isEdit} autoComplete="new-password" />
        </Field>
        <Field label="Repeat password">
          <input className="input" name="confirm" type="password" maxLength={200} required={!isEdit} autoComplete="new-password" />
        </Field>
        {isSelf && onOpenChangePassword && (
          <div className="-mt-1 flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
            <span>Verify current password instead?</span>
            <button
              type="button"
              className="font-medium text-brand-600 underline hover:text-brand-700"
              onClick={onOpenChangePassword}
            >
              Change password
            </button>
          </div>
        )}
        <Alert message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving}>{saving ? "Saving…" : isEdit ? "Save" : "Add User"}</button>
        </div>
      </form>
    </Modal>
  );
}

