"use client";

import { useCallback, useState } from "react";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/env";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "@/components/tags";
import { StatusBadge } from "@/components/certainty";
import { UserAvatar } from "@/components/user-avatar";
import { byRole } from "@/lib/taxonomy";

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

/** Org members + invitations (docs/08 §7). Members/invitations are server-fetched (reliable
 *  session) and passed in as initial state - no client auth race on first paint. The client
 *  Supabase session (Bearer) is used only to refresh after an invite; Admin+ invite endpoints
 *  surface 403s inline for viewers. */
export function OrgPanel({
  orgId,
  initialMembers = [],
  initialInvites = [],
}: {
  orgId: string;
  initialMembers?: Member[];
  initialInvites?: Invitation[];
}) {
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [invites, setInvites] = useState<Invitation[]>(initialInvites);
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
    if (i.data) setInvites(i.data as Invitation[]);
  }, [orgId, authHeaders]);

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
      toast.success(`Invitation sent to ${body.data.email}`, {
        description: `They'll join as ${body.data.role} once they accept.`,
      });
      void load();
    } else {
      const message = body.error?.message ?? `Failed (${res.status})`;
      setNote(message);
      toast.error("Couldn't send the invitation", { description: message });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4" /> Members &amp; access
        </CardTitle>
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
              [...members].sort(byRole).map((m) => (
                <li key={m.userId} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <UserAvatar name={m.name} email={m.email} size={28} />
                    <span className="truncate">
                      <span className="font-medium">{m.name ?? m.email}</span>{" "}
                      <span className="text-muted-foreground">{m.email}</span>
                    </span>
                  </span>
                  <RoleBadge role={m.role} />
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
                  <StatusBadge status={i.status} />
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
