/**
 * Dependency-manifest parser (docs/plans/security-vulnerabilities.md step 1, pure). Extracts DIRECT
 * dependencies per ecosystem so the connector can emit `external.package` nodes + DEPENDS_ON_PKG
 * edges — the input the OSV enrichment stage turns into real vulnerabilities. Mirrors the GitHub
 * connector's parser (npm/pypi/go) and adds Maven (pom.xml). A parse failure degrades only that
 * manifest's signal (returns []) — never throws.
 */
export interface PackageDep {
  ecosystem: string;
  name: string;
  version: string | null;
}

/** Files we look for in a repo (routed to their parser by basename). */
export const MANIFEST_PATHS = ["package.json", "requirements.txt", "go.mod", "pom.xml"];

/** Route a file to its ecosystem parser by basename; returns [] for unknown files. */
export function parseManifest(path: string, content: string): PackageDep[] {
  const file = path.split("/").pop() ?? path;
  if (file === "package.json") return parsePackageJson(content);
  if (file === "requirements.txt") return parseRequirementsTxt(content);
  if (file === "go.mod") return parseGoMod(content);
  if (file === "pom.xml") return parsePomXml(content);
  return [];
}

function parsePackageJson(content: string): PackageDep[] {
  let json: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    json = JSON.parse(content);
  } catch {
    return [];
  }
  const out: PackageDep[] = [];
  for (const section of [json.dependencies, json.devDependencies]) {
    for (const [name, version] of Object.entries(section ?? {})) {
      out.push({ ecosystem: "npm", name, version: version || null });
    }
  }
  return dedupe(out);
}

function parseRequirementsTxt(content: string): PackageDep[] {
  const out: PackageDep[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line || line.startsWith("-")) continue; // skip flags like -r/-e
    const m = /^([A-Za-z0-9._-]+)\s*(?:([=<>!~]=?)\s*(.+))?$/.exec(line);
    if (!m || !m[1]) continue;
    out.push({ ecosystem: "pypi", name: m[1], version: m[3]?.trim() ?? null });
  }
  return dedupe(out);
}

function parseGoMod(content: string): PackageDep[] {
  const out: PackageDep[] = [];
  let inBlock = false;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    if (line.startsWith("require (")) {
      inBlock = true;
      continue;
    }
    if (inBlock && line === ")") {
      inBlock = false;
      continue;
    }
    const body = inBlock
      ? line
      : line.startsWith("require ")
        ? line.slice("require ".length)
        : null;
    if (body == null) continue;
    const m = /^(\S+)\s+(\S+)/.exec(body.trim());
    if (m && m[1]) out.push({ ecosystem: "go", name: m[1], version: m[2] ?? null });
  }
  return dedupe(out);
}

/** Maven pom.xml — direct <dependency> entries. Package name is `groupId:artifactId` (OSV's
 *  Maven convention). Version may be a property (${...}) → left as-is (best-effort). */
function parsePomXml(content: string): PackageDep[] {
  const out: PackageDep[] = [];
  const depRe = /<dependency>([\s\S]*?)<\/dependency>/g;
  let m: RegExpExecArray | null;
  while ((m = depRe.exec(content)) !== null) {
    const block = m[1] ?? "";
    const groupId = tag(block, "groupId");
    const artifactId = tag(block, "artifactId");
    if (!groupId || !artifactId) continue;
    out.push({ ecosystem: "maven", name: `${groupId}:${artifactId}`, version: tag(block, "version") });
  }
  return dedupe(out);
}
function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}>\\s*([^<]+?)\\s*</${name}>`).exec(block);
  return m?.[1]?.trim() ?? null;
}

function dedupe(deps: PackageDep[]): PackageDep[] {
  const seen = new Set<string>();
  return deps.filter((d) => {
    const key = `${d.ecosystem}:${d.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
