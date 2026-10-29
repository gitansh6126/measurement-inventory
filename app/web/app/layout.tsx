import type { Metadata } from "next";
import type { ReactNode } from "react";
import { EnvBanner } from "@/components/EnvBanner";
import { DISPLAY_PREFS_BOOT } from "@/lib/displayPrefsBoot";
import "./globals.css";

export const metadata: Metadata = {
  title: "RS Machinery – Inventory",
  description: "Products, sales, purchases and inventory",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Saved display preferences (width, text size, spacing) before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: DISPLAY_PREFS_BOOT }} />
      </head>
      <body>
        <EnvBanner />
        {children}
      </body>
    </html>
  );
}
