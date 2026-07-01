"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/env";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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

/** Org members + invitations (docs/08 §7). Client component — reads with the app's
 *  Supabase session (Bearer); Admin+ invite endpoints surface 403s inline for viewers. */
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
      "X-Atlas-Org": orgId,
    };
  }, [orgId]);

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members &amp; access</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Members
          </p>
          <ul className="divide-y divide-border rounded-md border">
            {members.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">No members loaded.</li>
            ) : (
              members.map((m) => (
                <li key={m.userId} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{m.name ?? m.email}</span>{" "}
                    <span className="text-muted-foreground">{m.email}</span>
                  </span>
                  <Badge variant="secondary">{m.role}</Badge>
                </li>
              ))
            )}
          </ul>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Pending invitations
          </p>
          {invites.length ? (
            <ul className="divide-y divide-border rounded-md border">
              {invites.map((i) => (
                <li key={i.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>
                    {i.email} <span className="text-muted-foreground">· {i.role}</span>
                  </span>
                  <Badge variant="outline">{i.status}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None.</p>
          )}
        </div>

        <form onSubmit={invite} className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Invite a teammate
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              type="email"
              required
              className="min-w-56 flex-1"
              aria-label="Invite email"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "Member" | "Admin")}
              aria-label="Invite role"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="Member">Member</option>
              <option value="Admin">Admin</option>
            </select>
            <Button type="submit">Invite</Button>
          </div>
          {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
