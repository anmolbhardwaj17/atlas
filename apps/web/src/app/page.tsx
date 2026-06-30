import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { apiUrl } from "@/lib/env";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

interface OrgMembership {
  id: string;
  slug: string;
  name: string;
  role: string;
}
interface MeResponse {
  user: { id: string; email: string; name: string | null; avatarUrl: string | null };
  emailVerified: boolean;
  orgs: OrgMembership[];
  activeOrg: OrgMembership | null;
}

const page = { fontFamily: "system-ui, sans-serif", color: "#e8eaed", background: "#0b0d12" };

async function fetchMe(
  accessToken: string,
): Promise<{ me: MeResponse | null; error: string | null }> {
  try {
    const res = await fetch(`${apiUrl()}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return { me: null, error: `API /me responded ${res.status}` };
    return { me: (await res.json()) as MeResponse, error: null };
  } catch (e) {
    return { me: null, error: `Could not reach API: ${(e as Error).message}` };
  }
}

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main style={{ ...page, minHeight: "100dvh", display: "grid", placeItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <h1>Atlas</h1>
          <p style={{ color: "#9aa0a6" }}>
            The knowledge graph is the product. The AI is the interface.
          </p>
          <Link
            href="/login"
            style={{ color: "#8ab4f8", display: "inline-block", marginTop: "1rem" }}
          >
            Sign in →
          </Link>
        </div>
      </main>
    );
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const { me, error } = session?.access_token
    ? await fetchMe(session.access_token)
    : { me: null, error: "No access token in session" };

  return (
    <main
      style={{ ...page, minHeight: "100dvh", padding: "3rem", maxWidth: 720, margin: "0 auto" }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Atlas</h1>
        <SignOutButton />
      </header>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1rem", color: "#9aa0a6" }}>Signed in as</h2>
        <p style={{ margin: ".25rem 0" }}>
          <strong>{me?.user.name ?? user.email}</strong> — {me?.user.email ?? user.email}{" "}
          {me?.emailVerified ? (
            <span style={{ color: "#81c995" }}>✓ verified</span>
          ) : (
            <span style={{ color: "#f28b82" }}>unverified</span>
          )}
        </p>
        <p style={{ color: "#5f6368", fontSize: ".8rem" }}>user id: {me?.user.id ?? user.id}</p>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1rem", color: "#9aa0a6" }}>Organizations</h2>
        {error ? (
          <p style={{ color: "#f28b82" }}>{error}</p>
        ) : me && me.orgs.length > 0 ? (
          <ul>
            {me.orgs.map((o) => (
              <li key={o.id}>
                {o.name} <span style={{ color: "#5f6368" }}>({o.slug})</span> — {o.role}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: "#9aa0a6" }}>
            No organizations yet. Onboarding (create / join an org) arrives in F1.6.
          </p>
        )}
      </section>
    </main>
  );
}
