import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ApiException } from "../common/errors";
import { parseBody } from "../common/validation";
import type { AuthedRequest } from "../auth/auth.types";
import {
  NotificationService,
  CHANNEL_KINDS,
  type ChannelKind,
  type ChannelSummary,
  type EmailPrefs,
  type NotificationItem,
} from "./notification.service";

function org(req: AuthedRequest): { id: string } {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org;
}

function userId(req: AuthedRequest): string {
  if (!req.auth?.userId) throw ApiException.orgAccessDenied("Missing user context.");
  return req.auth.userId;
}

const EmailPrefsSchema = z
  .object({
    incidentEmail: z.boolean().optional(),
    weeklyDigest: z.boolean().optional(),
  })
  .strict();

function asChannelKind(kind: string): ChannelKind {
  if (!(CHANNEL_KINDS as string[]).includes(kind)) {
    throw new ApiException(422, "validation_failed", `Unknown channel "${kind}".`);
  }
  return kind as ChannelKind;
}

const SetChannelSchema = z
  .object({
    kind: z.enum(CHANNEL_KINDS as [ChannelKind, ...ChannelKind[]]),
    webhookUrl: z.string().trim().min(1),
  })
  .strict();

/**
 * Notification settings (proactive push). Admin manages the org's outbound channel; the
 * webhook URL is a bearer-capability secret so it's write-only (GET never returns it).
 */
@Controller("notifications")
@UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @Roles("Member")
  async channels(@Req() req: AuthedRequest): Promise<ChannelSummary[]> {
    return this.notifications.listChannels(org(req).id);
  }

  // ── Per-user email preferences. Self-scoped — any member manages their own mail. ──

  @Get("email-prefs")
  @Roles("Member")
  async emailPrefs(@Req() req: AuthedRequest): Promise<EmailPrefs> {
    return this.notifications.getEmailPrefs(org(req).id, userId(req));
  }

  @Patch("email-prefs")
  @Roles("Member")
  async setEmailPrefs(@Req() req: AuthedRequest, @Body() body: unknown): Promise<EmailPrefs> {
    const prefs = parseBody(EmailPrefsSchema, body);
    return this.notifications.setEmailPrefs(org(req).id, userId(req), prefs);
  }

  // ── In-app notification feed (the bell). Any member can read + mark their inbox. ──

  @Get("inbox")
  @Roles("Member")
  async inbox(@Req() req: AuthedRequest): Promise<{ items: NotificationItem[]; unread: number }> {
    return this.notifications.listFeed(org(req).id);
  }

  @Post("inbox/read-all")
  @Roles("Member")
  async readAll(@Req() req: AuthedRequest): Promise<{ ok: true }> {
    await this.notifications.markAllRead(org(req).id);
    return { ok: true };
  }

  @Post("inbox/:id/read")
  @Roles("Member")
  async read(@Req() req: AuthedRequest, @Param("id") id: string): Promise<{ ok: true }> {
    await this.notifications.markRead(org(req).id, id);
    return { ok: true };
  }

  @Post("channels")
  @Roles("Admin")
  async setChannel(@Req() req: AuthedRequest, @Body() body: unknown): Promise<ChannelSummary[]> {
    const { kind, webhookUrl } = parseBody(SetChannelSchema, body);
    return this.notifications.setChannel(org(req).id, kind, webhookUrl);
  }

  @Post("channels/:kind/test")
  @Roles("Admin")
  async testChannel(
    @Req() req: AuthedRequest,
    @Param("kind") kind: string,
  ): Promise<{ delivered: boolean; message: string }> {
    return this.notifications.testChannel(org(req).id, asChannelKind(kind));
  }

  @Delete("channels/:kind")
  @Roles("Admin")
  async removeChannel(
    @Req() req: AuthedRequest,
    @Param("kind") kind: string,
  ): Promise<ChannelSummary[]> {
    return this.notifications.removeChannel(org(req).id, asChannelKind(kind));
  }
}
