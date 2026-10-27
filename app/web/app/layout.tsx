import type { Metadata } from "next";
import type { ReactNode } from "react";
import { EnvBanner } from "@/components/EnvBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: "RS Machinery – Inventory",
  description: "Products, sales, purchases and inventory",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <EnvBanner />
        {children}
      </body>
    </html>
  );
}
