"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, MoreHorizontal, Users, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/env";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RoleBadge } from "@/components/tags";
import { StatusBadge } from "@/components/certainty";
import { UserAvatar } from "@/components/user-avatar";
import { byRole } from "@/lib/taxonomy";
import { cn } from "@/lib/cn";
import { changeMemberRole, removeMember, revokeInvitation } from "@/lib/browser-api";

interface Member {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
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

type ManageRole = "Owner" | "Admin" | "Member";

/** Org members + invitations (docs/08 §7). Members/invitations are server-fetched (reliable
 *  session) and passed in as initial state - no client auth race on first paint. Admins can change
 *  roles, remove members, and revoke invites (the API enforces the role hierarchy + last-Owner
 *  rules; illegal options are hidden here and any server rejection surfaces as a toast). */
export function OrgPanel({
  orgId,
  currentRole,
  currentEmail,
  initialMembers = [],
  initialInvites = [],
}: {
  orgId: string;
  currentRole: string;
  currentEmail: string;
  initialMembers?: Member[];
  initialInvites?: Invitation[];
}) {
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [invites, setInvites] = useState<Invitation[]>(initialInvites);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"Member" | "Admin">("Member");
  const [note, setNote] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  // The last invite we created + its accept link, kept visible so the inviter can copy/share it —
  // the primary way to bring in a teammate while email delivery isn't configured yet.
  const [lastInvite, setLastInvite] = useState<{
    email: string;
    role: string;
    url?: string;
    emailed: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [busyInvite, setBusyInvite] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<Member | null>(null);

  const isAdmin = currentRole === "Owner" || currentRole === "Admin";
  const isOwner = currentRole === "Owner";

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

  // The "Invited X" confirmation is transient — clear it after 4s (the copy-link box persists).
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 4000);
    return () => window.clearTimeout(t);
  }, [note]);

  async function invite(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setNote(null);
    setInviting(true);
    try {
      const res = await fetch(`${apiUrl()}/orgs/${orgId}/invitations`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const body = await res.json();
      if (res.ok) {
        const invitedEmail = body.data.email as string;
        const invitedRole = body.data.role as string;
        const url = body.data.acceptUrl as string | undefined;
        const emailed = body.data.emailed === true;
        setEmail("");
        setNote(`Invited ${invitedEmail} as ${invitedRole}.`);
        setLastInvite({ email: invitedEmail, role: invitedRole, emailed, ...(url ? { url } : {}) });
        setCopied(false);
        toast.success(
          emailed
            ? `Invitation emailed to ${invitedEmail}`
            : `Invitation created for ${invitedEmail}`,
          {
            description: emailed
              ? `They'll join as ${invitedRole} once they accept.`
              : `Email couldn't be delivered — share the invite link below.`,
          },
        );
        void load();
      } else {
        const message = body.error?.message ?? `Failed (${res.status})`;
        setNote(message);
        toast.error("Couldn't send the invitation", { description: message });
      }
    } finally {
      setInviting(false);
    }
  }

  async function copyLink(url: string): Promise<void> {
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually.");
    }
  }

  async function onChangeRole(m: Member, next: ManageRole): Promise<void> {
    if (next === m.role) return;
    setBusyUser(m.userId);
    try {
      const updated = await changeMemberRole(orgId, m.userId, next);
      setMembers((prev) =>
        prev.map((x) => (x.userId === m.userId ? { ...x, role: updated.role } : x)),
      );
      toast.success(`${m.name ?? m.email} is now ${updated.role}`);
    } catch (e) {
      toast.error("Couldn't change role", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusyUser(null);
    }
  }

  async function confirmRemoval(): Promise<void> {
    const m = pendingRemoval;
    if (!m) return;
    setBusyUser(m.userId);
    try {
      await removeMember(orgId, m.userId);
      setMembers((prev) => prev.filter((x) => x.userId !== m.userId));
      toast.success(`Removed ${m.name ?? m.email}`);
      setPendingRemoval(null);
    } catch (e) {
      toast.error("Couldn't remove member", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusyUser(null);
    }
  }

  async function onRevoke(inv: Invitation): Promise<void> {
    setBusyInvite(inv.id);
    try {
      await revokeInvitation(orgId, inv.id);
      setInvites((prev) => prev.filter((x) => x.id !== inv.id));
      toast.success(`Revoked the invite to ${inv.email}`);
    } catch (e) {
      toast.error("Couldn't revoke the invite", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusyInvite(null);
    }
  }

  // Roles an admin may assign. Only an Owner can grant Owner (ownership escalation).
  const assignable: ManageRole[] = isOwner ? ["Owner", "Admin", "Member"] : ["Admin", "Member"];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4" /> Members &amp; access
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Members
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {members.length}
            </span>
          </p>
          <ul className="divide-y divide-border rounded-md border">
            {members.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">No members yet.</li>
            ) : (
              [...members].sort(byRole).map((m) => {
                const isSelf = m.email === currentEmail;
                // An admin can manage everyone but themselves; only an Owner may manage an Owner.
                const canManage = isAdmin && !isSelf && !(m.role === "Owner" && !isOwner);
                return (
                  <li
                    key={m.userId}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <UserAvatar value={m.avatarUrl} name={m.name} email={m.email} size={28} />
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{m.name ?? m.email}</span>{" "}
                        {m.name ? <span className="text-muted-foreground">{m.email}</span> : null}
                        {isSelf ? (
                          <span className="ml-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            You
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <RoleBadge role={m.role} />
                      {canManage ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              disabled={busyUser === m.userId}
                              aria-label={`Manage ${m.name ?? m.email}`}
                              className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                            >
                              {busyUser === m.userId ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <MoreHorizontal className="size-4" />
                              )}
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                              Change role
                            </DropdownMenuLabel>
                            {assignable.map((r) => (
                              <DropdownMenuItem
                                key={r}
                                onClick={() => void onChangeRole(m, r)}
                                className="justify-between"
                              >
                                {r}
                                {m.role === r ? <Check className="size-3.5" /> : null}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setPendingRemoval(m)}
                              className="text-danger focus:text-danger"
                            >
                              Remove from org
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </span>
                  </li>
                );
              })
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
                <li
                  key={i.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {i.email} <span className="text-muted-foreground">· {i.role}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <StatusBadge status={i.status} />
                    {isAdmin ? (
                      <button
                        type="button"
                        onClick={() => void onRevoke(i)}
                        disabled={busyInvite === i.id}
                        aria-label={`Revoke invite to ${i.email}`}
                        title="Revoke invite"
                        className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-danger disabled:opacity-50"
                      >
                        {busyInvite === i.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <X className="size-4" />
                        )}
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None.</p>
          )}
        </div>

        {isAdmin ? (
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
              <Select value={role} onValueChange={(v) => setRole(v as "Member" | "Admin")}>
                <SelectTrigger className="h-9 w-32" aria-label="Invite role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Member">Member</SelectItem>
                  <SelectItem value="Admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" disabled={inviting}>
                {inviting ? <Loader2 className="size-4 animate-spin" /> : null}
                Invite
              </Button>
            </div>
            {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
            {/* After an invite: confirm it emailed, OR — when delivery failed / isn't configured —
                fall back to the copyable accept link (which always works). Honest either way. */}
            {lastInvite ? (
              <div className="space-y-2 rounded-md border bg-muted/40 p-3">
                <div className="flex items-start justify-between gap-2">
                  {lastInvite.emailed ? (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Check className="size-3.5 shrink-0 text-success" />
                      Invitation emailed to{" "}
                      <span className="font-medium text-foreground">{lastInvite.email}</span>. You
                      can also copy the link:
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Email couldn&rsquo;t be delivered — send this link to{" "}
                      <span className="font-medium text-foreground">{lastInvite.email}</span> so
                      they can join:
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setLastInvite(null)}
                    aria-label="Dismiss"
                    className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                {lastInvite.url ? (
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={lastInvite.url}
                      onFocus={(e) => e.currentTarget.select()}
                      className="h-9 flex-1 font-mono text-xs"
                      aria-label="Invite link"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const u = lastInvite.url;
                        if (u) void copyLink(u);
                      }}
                    >
                      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                      {copied ? "Copied" : "Copy link"}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </form>
        ) : null}
      </CardContent>

      {/* Remove-member confirmation (destructive, needs an explicit yes). */}
      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(o) => {
          if (!o) setPendingRemoval(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this member?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemoval ? (
                <>
                  <span className="font-medium text-foreground">
                    {pendingRemoval.name ?? pendingRemoval.email}
                  </span>{" "}
                  will lose access to this organization. They can be re-invited later.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyUser !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmRemoval();
              }}
              className={cn("bg-danger text-white hover:bg-danger/90")}
            >
              {busyUser === pendingRemoval?.userId ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
