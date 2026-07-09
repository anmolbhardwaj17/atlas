import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OrgService } from "./org.service";
import { OrgLogoService } from "./org-logo.service";
import { InvitationService } from "./invitation.service";
import { OrgController } from "./org.controller";
import { InvitationController } from "./invitation.controller";

/**
 * Organizations / RBAC / memberships / invitations (docs/12 §5-6, F1.6). Imports
 * AuthModule for the guards + UserMirrorService used by the services.
 */
@Module({
  imports: [AuthModule],
  controllers: [OrgController, InvitationController],
  providers: [OrgService, OrgLogoService, InvitationService],
})
export class OrgsModule {}
