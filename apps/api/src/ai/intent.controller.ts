import { Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { CoverageAssessment } from "@atlas/ai";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ApiException } from "../common/errors";
import type { AuthedRequest } from "../auth/auth.types";
import { AiService } from "./ai.service";

/**
 * Intent Verification (IV-3, docs/plans/intent-verification.md). Judges whether a PR implements
 * the intent of its linked Jira issue — hedged, cited coverage questions, NOT code-quality review
 * (SIFT owns that). Member+ and org-scoped (guards + GraphService RLS, R8). Its own `/intent` prefix
 * keeps this axis (spec → code) distinct from `/ai` (the graph Q&A) even though both use the engine.
 */
@Controller("intent")
@UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
export class IntentController {
  constructor(private readonly ai: AiService) {}

  /** Review a PR's coverage of its linked Jira intent. Returns the structured assessment
   *  (per-acceptance-criterion status + cited notes + honest caveats). */
  @Post("prs/:id/coverage")
  @Roles("Member")
  async coverage(@Req() req: AuthedRequest, @Param("id") id: string): Promise<CoverageAssessment> {
    return this.ai.coverageForPr(org(req).id, id);
  }

  /** Ticket-level coverage: judge a Jira issue against ALL the PRs that implement it (a Story is
   *  delivered across many PRs, so this is the accurate unit). */
  @Post("issues/:id/coverage")
  @Roles("Member")
  async issueCoverage(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
  ): Promise<CoverageAssessment> {
    return this.ai.coverageForIssue(org(req).id, id);
  }

  /** Propose fuzzy (no-key) PR→issue links as `ai_suggested` IMPLEMENTS edges for confirm/reject
   *  in the graph (IV-4). Admin — it scans the estate + writes suggestions. */
  @Post("suggest-links")
  @Roles("Admin")
  async suggestLinks(
    @Req() req: AuthedRequest,
  ): Promise<{ suggested: number; scannedPrs: number; scannedIssues: number }> {
    return this.ai.suggestIntentLinks(org(req).id);
  }
}

function org(req: AuthedRequest): { id: string } {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org;
}
