import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
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
  type ChannelStatus,
  type NotificationItem,
} from "./notification.service";

function org(req: AuthedRequest): { id: string } {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org;
}

const SetSlackSchema = z.object({ webhookUrl: z.string().trim().min(1) }).strict();

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
  async status(@Req() req: AuthedRequest): Promise<ChannelStatus> {
    return this.notifications.getStatus(org(req).id);
  }

  // ── In-app notification feed (the bell). Any member can read + mark their inbox. ──

  @Get("inbox")
  @Roles("Member")
  async inbox(
    @Req() req: AuthedRequest,
  ): Promise<{ items: NotificationItem[]; unread: number }> {
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

  @Post("slack")
  @Roles("Admin")
  async setSlack(@Req() req: AuthedRequest, @Body() body: unknown): Promise<ChannelStatus> {
    const { webhookUrl } = parseBody(SetSlackSchema, body);
    return this.notifications.setSlack(org(req).id, webhookUrl);
  }

  @Post("test")
  @Roles("Admin")
  async test(@Req() req: AuthedRequest): Promise<{ delivered: boolean; message: string }> {
    return this.notifications.test(org(req).id);
  }

  @Delete()
  @Roles("Admin")
  async disable(@Req() req: AuthedRequest): Promise<ChannelStatus> {
    return this.notifications.disable(org(req).id);
  }
}
