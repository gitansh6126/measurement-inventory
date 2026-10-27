import nodemailer from "nodemailer";
import type { Env } from "../env.js";
import { log } from "./logger.js";

export async function sendPasswordResetCode(env: Env, email: string, code: string, requestId: string): Promise<void> {
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    // Audit M1: a code in the log lets whoever reads the log reset the account, so only the
    // Demo / Test environments fall back to logging it. Client Ready refuses earlier (routes/auth.ts).
    if (env.APP_ENV === "DEMO" || env.APP_ENV === "TEST") {
      log.warn("password_reset_code_logged", { email, code, requestId, reason: "smtp_not_configured" });
      return;
    }
    throw new Error("Email delivery is not configured");
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  await transporter.sendMail({
    from: env.SMTP_FROM ?? env.SMTP_USER,
    to: email,
    subject: "RS Inventory password reset code",
    text: `Your RS Inventory password reset code is ${code}. It expires in 15 minutes. If you did not request this, ignore this email.`,
  });
}
