import type { ReactNode } from "react";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata = {
  title: "Atlas",
  description: "AI-powered Engineering Intelligence Platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: browser extensions inject attributes on <body>
          (e.g. cz-shortcut-listen) which would otherwise trip a hydration warning. */}
      <body suppressHydrationWarning>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
