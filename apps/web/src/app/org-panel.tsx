"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/env";

interface Member {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
}
interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
}

/** Org management (docs/08 §7): lists members + pending invitations and creates
 *  invites. Calls the API with the app's Supabase session (Bearer). Admin+ only
 *  endpoints — a Member viewer will see 403s surfaced inline. */
export function OrgPanel({ orgId }: { orgId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"Member" | "Admin">("Member");
  const [note, setNote] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    return {
      "content-type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    };
  }, []);

  const load = useCallback(async () => {
    const h = await authHeaders();
    const [m, i] = await Promise.all([
      fetch(`${apiUrl()}/orgs/${orgId}/members`, { headers: h }).then((r) => r.json()),
      fetch(`${apiUrl()}/orgs/${orgId}/invitations`, { headers: h }).then((r) => r.json()),
    ]);
    if (m.data) setMembers(m.data as Member[]);
    setInvites(i.data ? (i.data as Invitation[]) : []);
  }, [orgId, authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setNote(null);
    const res = await fetch(`${apiUrl()}/orgs/${orgId}/invitations`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ email: email.trim(), role }),
    });
    const body = await res.json();
    if (res.ok) {
      setEmail("");
      setNote(`Invited ${body.data.email} as ${body.data.role}.`);
      void load();
    } else {
      setNote(body.error?.message ?? `Failed (${res.status})`);
    }
  }

  const box = { border: "1px solid #1d212b", borderRadius: 8, padding: "1rem", marginTop: "1rem" };
  return (
    <div style={box}>
      <h3 style={{ margin: "0 0 .5rem", fontSize: ".95rem" }}>Members</h3>
      <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
        {members.map((m) => (
          <li key={m.userId}>
            {m.name ?? m.email} <span style={{ color: "#5f6368" }}>({m.email})</span> — {m.role}
          </li>
        ))}
      </ul>

      <h3 style={{ margin: "1rem 0 .5rem", fontSize: ".95rem" }}>Pending invitations</h3>
      {invites.length ? (
        <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
          {invites.map((i) => (
            <li key={i.id}>
              {i.email} — {i.role} <span style={{ color: "#5f6368" }}>({i.status})</span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ color: "#9aa0a6", margin: 0 }}>None.</p>
      )}

      <form onSubmit={invite} style={{ display: "flex", gap: ".5rem", marginTop: ".75rem" }}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@company.com"
          type="email"
          required
          style={{
            flex: 1,
            padding: ".4rem .6rem",
            borderRadius: 6,
            border: "1px solid #2a2f3a",
            background: "#11141b",
            color: "#e8eaed",
          }}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "Member" | "Admin")}
          style={{
            padding: ".4rem",
            borderRadius: 6,
            border: "1px solid #2a2f3a",
            background: "#11141b",
            color: "#e8eaed",
          }}
        >
          <option value="Member">Member</option>
          <option value="Admin">Admin</option>
        </select>
        <button
          type="submit"
          style={{
            padding: ".4rem .9rem",
            borderRadius: 6,
            border: "1px solid #2a2f3a",
            background: "#8ab4f8",
            color: "#0b0d12",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Invite
        </button>
      </form>
      {note ? <p style={{ color: "#9aa0a6", marginTop: ".5rem" }}>{note}</p> : null}
    </div>
  );
}
