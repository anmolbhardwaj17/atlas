import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AtlasLogo } from "@/components/brand";

/** Shell for the public legal pages (Terms, Privacy). Standalone, unauthenticated, light. */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-white text-neutral-900">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <AtlasLogo size={24} className="size-6" /> Atlas
          </Link>
          <Link
            href="/login"
            className="flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-900"
          >
            <ArrowLeft className="size-4" /> Back to sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12">{children}</main>
      <footer className="mx-auto max-w-3xl px-6 pb-12">
        <div className="flex gap-4 border-t border-neutral-200 pt-6 text-sm text-neutral-500">
          <Link href="/legal/terms" className="hover:text-neutral-900">
            Terms of Service
          </Link>
          <Link href="/legal/privacy" className="hover:text-neutral-900">
            Privacy Policy
          </Link>
        </div>
      </footer>
    </div>
  );
}
