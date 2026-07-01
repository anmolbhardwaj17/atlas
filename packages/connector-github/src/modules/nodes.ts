/**
 * Leaf node modules with no observed edges of their own: team, user (CODEOWNERS/PR
 * targets) and external package (DEPENDS_ON_PKG target). They exist so the edges other
 * modules emit resolve to real nodes (docs/07 §7.2/§7.3).
 */
import { teamUrn, userUrn, packageUrn } from "../urn";
import type { GithubModule } from "./module";

export interface TeamPayload {
  owner: string;
  data: { slug: string; name?: string; description?: string };
}

export const teamModule: GithubModule<TeamPayload> = {
  kind: "github.team",
  normalize({ owner, data }) {
    return {
      urn: teamUrn(owner, data.slug),
      kind: "github.team",
      displayName: data.name ?? data.slug,
      attributes: { owner, slug: data.slug, name: data.name },
    };
  },
  observedEdges() {
    return [];
  },
  extractSignals() {
    return [];
  },
};

export interface UserPayload {
  data: { login: string; name?: string | null; type?: string };
}

export const userModule: GithubModule<UserPayload> = {
  kind: "github.user",
  normalize({ data }) {
    return {
      urn: userUrn(data.login),
      kind: "github.user",
      displayName: data.name ?? data.login,
      attributes: { login: data.login, name: data.name ?? null, type: data.type },
    };
  },
  observedEdges() {
    return [];
  },
  extractSignals() {
    return [];
  },
};

export interface PackagePayload {
  ecosystem: string;
  name: string;
  version?: string | null;
}

export const packageModule: GithubModule<PackagePayload> = {
  kind: "external.package",
  normalize({ ecosystem, name, version }) {
    return {
      urn: packageUrn(ecosystem, name),
      kind: "external.package",
      displayName: name,
      attributes: { ecosystem, name, version: version ?? null },
    };
  },
  observedEdges() {
    return [];
  },
  extractSignals() {
    return [];
  },
};
