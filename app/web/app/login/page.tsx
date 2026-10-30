"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@rs-v31/shared";
import { ApiError, api, type VersionInfo } from "@/lib/api";

const ROLE_LABEL = { admin: "Admin", sales_manager: "Sales manager", sales_staff: "Sales staff" } as const;
type LoginFlow = "sign-in" | "request-code" | "reset-password";

/** Where to go after sign-in: the screen the expired session was on (same-origin paths only). */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next") ?? "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
}

export default function LoginPage() {
  const router = useRouter();
  const [flow, setFlow] = useState<LoginFlow>("sign-in");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);
  // Audit M2: the submit button stays disabled until React has hydrated, so a fast click or an
  // automation agent can never trigger the browser's own form submission.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
    // Audit M4: sent here by an expired session.
    if (new URLSearchParams(window.location.search).get("expired")) setNotice("Your session has ended. Please sign in again.");
  }, []);

  // Demo accounts are offered only when the server says it is the DEMO environment.
  useEffect(() => {
    api<VersionInfo>("/version").then((v) => setDemo(v.environment === "DEMO"), () => setDemo(false));
  }, []);

  async function signIn(loginEmail: string, password: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/auth/login", { method: "POST", body: { email: loginEmail, password } });
      router.replace(nextPath());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  async function requestResetCode() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/auth/password-reset/request", { method: "POST", body: { email } });
      setFlow("reset-password");
      setNotice("If the address belongs to an active account, a 6-digit code has been sent. If SMTP is not configured, check the API server log for the code.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPasswordReset(code: string, newPassword: string, confirmPassword: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/auth/password-reset/confirm", {
        method: "POST",
        body: { email, code, newPassword, confirmPassword },
      });
      setFlow("sign-in");
      setNotice("Password updated. Sign in with your new password.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (flow === "sign-in") {
      void signIn(email, String(form.get("password") ?? ""));
    } else if (flow === "request-code") {
      void requestResetCode();
    } else {
      void confirmPasswordReset(
        String(form.get("code") ?? ""),
        String(form.get("newPassword") ?? ""),
        String(form.get("confirmPassword") ?? "")
      );
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <form className="card grid w-full max-w-sm gap-4 p-6" method="post" data-enter-last="submit" onSubmit={onSubmit} aria-busy={busy}>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">RS Machinery</h1>
          <p className="text-sm text-slate-500">
            {flow === "sign-in" ? "Sign in to continue" : flow === "request-code" ? "Get a password reset code" : "Choose a new password"}
          </p>
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            readOnly={flow === "reset-password"}
          />
        </div>
        {flow === "sign-in" && (
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" className="input" name="password" type="password" autoComplete="current-password" required />
          </div>
        )}
        {flow === "reset-password" && (
          <>
            <div>
              <label className="label" htmlFor="code">6-digit code</label>
              <input id="code" className="input" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required />
            </div>
            <div>
              <label className="label" htmlFor="newPassword">New password</label>
              <input id="newPassword" className="input" name="newPassword" type="password" autoComplete="new-password" minLength={10} maxLength={200} required />
            </div>
            <div>
              <label className="label" htmlFor="confirmPassword">Confirm new password</label>
              <input id="confirmPassword" className="input" name="confirmPassword" type="password" autoComplete="new-password" minLength={10} maxLength={200} required />
            </div>
          </>
        )}
        {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
        {notice && <p className="text-sm text-emerald-700" role="status">{notice}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy || !ready}>
          {busy
            ? "Please wait…"
            : flow === "sign-in"
              ? "Sign in"
              : flow === "request-code"
                ? "Send reset code"
                : "Update password"}
        </button>
        {flow === "sign-in" && (
          <button
            type="button"
            className="text-sm text-blue-700 underline underline-offset-2"
            disabled={busy}
            onClick={() => {
              setError("");
              setNotice("");
              setFlow("request-code");
            }}
          >
            Forgot password?
          </button>
        )}
        {flow !== "sign-in" && (
          <button
            type="button"
            className="text-sm text-blue-700 underline underline-offset-2"
            disabled={busy}
            onClick={() => {
              setError("");
              setNotice("");
              setFlow("sign-in");
            }}
          >
            Back to sign in
          </button>
        )}
        {demo && flow === "sign-in" && (
          <div className="grid gap-2 border-t border-slate-200 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Demo company — sign in as</p>
            <div className="grid grid-cols-3 gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button key={account.email} type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => void signIn(account.email, DEMO_PASSWORD)}>
                  {ROLE_LABEL[account.role]}
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </main>
  );
}
