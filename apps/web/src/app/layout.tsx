import type { ReactNode } from "react";

export const metadata = {
  title: "Atlas",
  description: "AI-powered Engineering Intelligence Platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
