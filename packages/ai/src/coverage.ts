/**
 * Intent-coverage judge (docs/plans/intent-verification.md §3, IV-3). Given a PR's linked Jira
 * intent (summary + description + acceptance criteria + subtasks + comments) and its actual code
 * diff, it judges - per acceptance criterion - whether the diff plausibly ADDRESSES the stated
 * intent, and surfaces gaps as hedged reviewer QUESTIONS cited to the criterion and the diff.
 *
 * This is NOT code review (SIFT owns code-logic quality). It is the softest truth-claim Atlas makes -
 * a judgment, not a graph fact - so its correctness rests on a DETERMINISTIC suppression gate, not on
 * trusting the model:
 *   - an "implemented" claim survives only if it cites a real diff hunk (else -> cannot-tell);
 *   - a "possibly-missing" flag survives only if it anchors to a real, given acceptance criterion
 *     (invented criteria are dropped);
 *   - criteria the model never addressed default to cannot-tell, never silently "implemented".
 * This is the analogue of G3's citation gate (docs/10 L4/L5) - it makes "never falsely say you didn't
 * build X" a structural property, not a hope (P3/P4). Honest "no linked issue / no diff / thin ACs"
 * states are first-class.
 *
 * The engine is pure and NestJS-free: `judgeCoverage(deps, inputs)` takes an assembled
 * `CoverageInputs`; the API assembles it from the graph (IMPLEMENTS edge -> issue attributes ->
 * on-demand PR diff) and wires an LLMProvider.
 */
import type { LLMProvider } from "./llm";
import { COVERAGE_SYSTEM } from "./prompt";

/** A Jira subtask captured on the issue node (a unit of intent in its own right). */
export interface IntentSubtask {
  key: string;
  summary: string | null;
  status: string | null;
}

/** A clarifying comment - intent frequently lives here, not in the summary (P4). */
export interface IntentComment {
  author: string | null;
  text: string;
}

/** Intent captured from a named Jira custom field (Acceptance Criteria / Definition of Done /
 *  Remediation …) — the connector detects these per-company so intent that lives OUTSIDE the
 *  description still reaches the judge (IV-3 (b), convention-agnostic). */
export interface IntentField {
  label: string;
  text: string;
}

/** The stated intent: a `jira.issue` node's captured attributes (IV-1). */
export interface IntentIssue {
  /** The issue node id (for citation provenance). */
  id: string;
  key: string;
  url: string | null;
  summary: string;
  description: string;
  subtasks: IntentSubtask[];
  comments: IntentComment[];
  /** Intent from named custom fields (highest-priority criteria when present). */
  intentFields?: IntentField[];
}

/** The PR under review. */
export interface CoveragePr {
  id: string;
  name: string | null;
}

/** Everything the judge needs, assembled by the caller (API in IV-3b). */
export interface CoverageInputs {
  pr: CoveragePr;
  /** The linked intent, or null if the PR has no IMPLEMENTS edge to a crawled issue. */
  issue: IntentIssue | null;
  /** The on-demand PR diff (unified diff text), or null if unavailable. */
  diff: { text: string; truncated: boolean } | null;
}

export type CriterionStatus = "implemented" | "possibly-missing" | "cannot-tell";

/** A bound citation on a coverage claim: an acceptance criterion or a specific diff hunk. */
export interface CoverageCitation {
  marker: string; // AC1 | H2
  kind: "acceptance-criterion" | "diff-hunk";
  /** Human-readable reference (criterion text head, or file@hunk-range). */
  ref: string;
  /** Provenance link when there is one (the Jira issue URL for criteria). */
  url?: string;
}

/** One acceptance criterion + its coverage judgment. */
export interface CoverageCriterion {
  id: string; // AC1
  text: string;
  source: "description" | "subtask" | "comment";
  status: CriterionStatus;
  /** The hedged reviewer note/question (never a code-quality verdict). */
  note: string;
  citations: CoverageCitation[];
}

export type CoverageStatus = "assessed" | "no-intent" | "no-diff";

export interface CoverageAssessment {
  status: CoverageStatus;
  pr: CoveragePr;
  issue: { id: string; key: string; url: string | null; summary: string } | null;
  criteria: CoverageCriterion[];
  /** Soft, skimmable overall note - observations and questions, never a pass/fail verdict. */
  summary: string;
  /** Staleness/assumption caveats (e.g. "no explicit acceptance criteria; assessed the description"). */
  caveats: string[];
  /** The standing hedge shown with every assessment - what this is and is not. */
  reviewNote: string;
}

export interface CoverageDeps {
  llm: LLMProvider;
  maxTokens?: number;
}

const REVIEW_NOTE =
  "These are intent-coverage questions for a human to confirm, not verdicts - the code may implement a criterion in a way this review didn't recognise. This checks whether the ticket's stated intent appears built; it does not review code correctness or quality.";

// ---- acceptance-criterion extraction (deterministic) -------------------------------------------

interface CriterionSeed {
  text: string;
  source: CoverageCriterion["source"];
}

const AC_HEADING =
  /^\s*(#+\s*)?(acceptance\s+criteria|acceptance|ac['’]?s?|definition\s+of\s+done|dod|requirements?|scope)\b\s*[:.]?\s*$/i;
const HEADING_LINE = /^\s*(#+\s+\S|[A-Z][A-Za-z ]{2,40}:\s*$)/;
const LIST_ITEM = /^\s*(?:[-*•·]|\[[ xX]\]|\(?\d+[.)]|\d+\s*[-.)])\s+(.*\S)\s*$/;
const GHERKIN = /^\s*(given|when|then|and|but)\b/i;

/** Strip a leading checkbox/bullet marker left inside a captured item. */
function cleanItem(s: string): string {
  return s
    .replace(/^\s*(?:[-*•·]|\[[ xX]\]|\(?\d+[.)]|\d+\s*[-.)])\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collect list items appearing under an "Acceptance Criteria"-style heading, if present. */
function itemsUnderAcHeading(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!AC_HEADING.test(lines[i] ?? "")) continue;
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j] ?? "";
      if (line.trim() === "") {
        // A single blank line inside a list is fine; two blanks or a new heading ends the block.
        if ((lines[j + 1] ?? "").trim() === "" || HEADING_LINE.test(lines[j + 1] ?? "")) break;
        continue;
      }
      if (AC_HEADING.test(line) || HEADING_LINE.test(line)) break;
      const m = LIST_ITEM.exec(line);
      if (m?.[1]) out.push(cleanItem(m[1]));
      else if (GHERKIN.test(line)) out.push(line.trim());
      else if (out.length > 0) break; // prose after the list = end of the AC block
    }
    if (out.length > 0) break;
  }
  return out;
}

/** Group consecutive Gherkin lines into scenarios (Given/When/Then -> one criterion). */
function gherkinScenarios(lines: string[]): string[] {
  const scenarios: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    if (current.length) scenarios.push(current.join(" "));
    current = [];
  };
  for (const line of lines) {
    if (GHERKIN.test(line)) {
      if (/^\s*given\b/i.test(line) && current.length) flush();
      current.push(line.trim());
    } else if (current.length) {
      flush();
    }
  }
  flush();
  return scenarios.filter((s) => /\bthen\b/i.test(s) || s.split(/\s+/).length >= 4);
}

/** All list items anywhere in the text (fallback when there is no explicit AC heading). */
function allListItems(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const m = LIST_ITEM.exec(line);
    if (m?.[1]) out.push(cleanItem(m[1]));
  }
  return out;
}

// A heading whose CONTENT expresses intent a fix should satisfy — for templated tickets that don't
// use "Acceptance Criteria": security findings (Remediation Recommendation / Finding Description) or
// bug reports (Expected behaviour / Steps to Reproduce). The heading name becomes the criterion label.
const INTENT_SECTION =
  /^\s*(#+\s*)?(remediation( recommendation)?|acceptance criteria|definition of done|expected( results?| behaviou?rs?)?|steps? to reproduce|requirements?|finding description|scope)\s*:?\s*$/i;
// Any short Title-Case (or markdown) line that bounds a section — used to find where a section ends.
const ANY_SECTION_HEADING = /^\s*(#+\s+\S|[A-Z][A-Za-z /]{2,45}:?)\s*$/;
const EMPTY_VALUE = /^\s*(na|n\/?a|none|tbd|-|nil)\s*$/i;

/**
 * Extract intent-bearing sections from a heading/value templated description (e.g. a Jira
 * "Remediation Recommendation" block). Each matched section's content becomes one criterion,
 * labelled by its heading; empty/"NA" sections are skipped.
 */
function intentSectionsFromDescription(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!INTENT_SECTION.test(lines[i] ?? "")) continue;
    const label = (lines[i] ?? "").replace(/[:#]/g, "").trim();
    const buf: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j] ?? "";
      if (line.trim() === "") {
        if (buf.length) break;
        continue;
      }
      if (ANY_SECTION_HEADING.test(line)) break; // next heading ends this section
      buf.push(line.trim());
    }
    const value = buf.join(" ").replace(/\s+/g, " ").trim();
    if (value && !EMPTY_VALUE.test(value)) out.push(`${label}: ${value}`);
  }
  return out;
}

/** Split a custom-field value into bullet items if it's a list, else the whole value as one item. */
function splitFieldItems(text: string): string[] {
  const items = allListItems(text.split(/\r?\n/));
  return items.length > 0 ? items : [text.replace(/\s+/g, " ").trim()];
}

const MAX_CRITERIA = 12;

/**
 * Extract acceptance criteria from a Jira issue (deterministic, convention-agnostic). Priority:
 * named custom fields (Acceptance Criteria / Remediation / DoD, if the connector captured them) ->
 * an explicit "Acceptance Criteria" list -> Gherkin scenarios -> intent-bearing template sections
 * (Remediation Recommendation / Expected / Steps to Reproduce, for non-AC tickets) -> any bullet
 * list. Subtasks add per-item criteria. Returns `explicit=false` only when nothing structured is
 * found (the caller then assesses against the whole description, with a caveat).
 */
export function extractAcceptanceCriteria(issue: IntentIssue): {
  seeds: CriterionSeed[];
  explicit: boolean;
} {
  const seeds: CriterionSeed[] = [];
  const seen = new Set<string>();
  const push = (text: string, source: CoverageCriterion["source"]): void => {
    const t = text.trim();
    if (!t || t.length < 3) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    seeds.push({ text: t.length > 300 ? `${t.slice(0, 300)}…` : t, source });
  };

  // 1) Named custom fields win — the company put intent in a dedicated field, on purpose.
  for (const f of issue.intentFields ?? []) {
    const items = splitFieldItems(f.text);
    if (items.length > 1) for (const it of items) push(it, "description");
    else if (items[0]) push(`${f.label}: ${items[0]}`, "description");
  }
  let explicit = seeds.length > 0;

  // 2) Structure inside the description.
  if (seeds.length === 0) {
    const lines = issue.description.split(/\r?\n/);
    let texts = itemsUnderAcHeading(lines);
    if (texts.length === 0) texts = gherkinScenarios(lines);
    if (texts.length === 0) texts = intentSectionsFromDescription(lines);
    if (texts.length === 0) texts = allListItems(lines);
    for (const t of texts) push(t, "description");
    if (seeds.length > 0) explicit = true;
  }

  // 3) Subtasks are units of intent too — include them so a ticket that expresses its "what" as
  // subtasks still gets per-item coverage.
  for (const s of issue.subtasks) {
    const label = s.summary?.trim();
    if (label) push(label, "subtask");
  }

  if (seeds.length === 0) {
    // Nothing structured: assess against the whole DESCRIPTION (not just the summary — the intent
    // usually lives there), else the summary. The caller flags the coarser-assessment caveat.
    const desc = issue.description.replace(/\s+/g, " ").trim();
    push(desc || issue.summary, "description");
    return { seeds: seeds.slice(0, MAX_CRITERIA), explicit: false };
  }
  return { seeds: seeds.slice(0, MAX_CRITERIA), explicit };
}

// ---- diff-hunk segmentation (deterministic) ----------------------------------------------------

export interface DiffHunk {
  id: string; // H1
  file: string;
  header: string; // the @@ ... @@ line (or a synthetic file header)
  body: string;
}

const MAX_HUNKS = 40;
const MAX_HUNK_CHARS = 1_500;

/**
 * Split a unified (git) diff into per-hunk segments, each with a stable [H#] marker the model can
 * cite. Tracks the current file from `diff --git`/`+++` headers; a `@@` line starts a new hunk.
 * Bounded (hunk count + per-hunk chars) so a huge PR can't blow the context budget.
 */
export function segmentDiff(diffText: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let file = "unknown";
  let current: DiffHunk | null = null;
  const flush = (): void => {
    if (current) {
      current.body = current.body.slice(0, MAX_HUNK_CHARS);
      hunks.push(current);
      current = null;
    }
  };
  for (const line of diffText.split(/\r?\n/)) {
    const gitHeader = /^diff --git a\/(\S+) b\/(\S+)/.exec(line);
    if (gitHeader) {
      flush();
      file = gitHeader[2] ?? gitHeader[1] ?? "unknown";
      continue;
    }
    const plusHeader = /^\+\+\+ b\/(\S+)/.exec(line);
    if (plusHeader) {
      file = plusHeader[1] ?? file;
      continue;
    }
    if (line.startsWith("@@")) {
      flush();
      if (hunks.length >= MAX_HUNKS) break;
      current = { id: `H${hunks.length + 1}`, file, header: line.trim(), body: "" };
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  flush();
  return hunks;
}

// ---- context assembly --------------------------------------------------------------------------

const MAX_DESC_CHARS = 2_000;
const MAX_COMMENTS = 6;
const MAX_COMMENT_CHARS = 400;

interface Prepared {
  criteria: CoverageCriterion[]; // seeded with status cannot-tell (default)
  hunks: DiffHunk[];
  context: string;
  caveats: string[];
}

function trim(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function prepare(inputs: CoverageInputs, issue: IntentIssue, diffText: string): Prepared {
  const { seeds, explicit } = extractAcceptanceCriteria(issue);
  const caveats: string[] = [];
  if (!explicit)
    caveats.push(
      "This ticket has no explicit acceptance criteria; the diff was assessed against its stated goal, which is coarser.",
    );

  const criteria: CoverageCriterion[] = seeds.map((s, i) => ({
    id: `AC${i + 1}`,
    text: s.text,
    source: s.source,
    status: "cannot-tell",
    note: "",
    citations: [],
  }));

  const hunks = segmentDiff(diffText);
  if (hunks.length === 0)
    caveats.push("No file hunks were parsed from the diff; coverage could not be located in code.");
  if (hunks.length >= MAX_HUNKS)
    caveats.push(`The diff is large; only the first ${MAX_HUNKS} hunks were reviewed.`);

  const intentLines: string[] = [
    `ISSUE: ${issue.key} - ${issue.summary}`,
    `DESCRIPTION: ${trim(issue.description.replace(/\s+\n/g, "\n").trim() || "(none)", MAX_DESC_CHARS)}`,
  ];
  // Named custom fields (Acceptance Criteria / Remediation / DoD) - the company's own intent fields.
  for (const f of issue.intentFields ?? []) {
    if (f.text.trim()) intentLines.push(`${f.label.toUpperCase()}: ${trim(f.text.trim(), 800)}`);
  }
  intentLines.push(
    "ACCEPTANCE CRITERIA (judge the diff against each; cite its [AC#] when you flag a gap):",
    ...criteria.map((c) => `  ${c.id} (${c.source}) ${c.text}`),
  );
  const comments = issue.comments.slice(0, MAX_COMMENTS).filter((c) => c.text.trim());
  if (comments.length) {
    intentLines.push("CLARIFYING COMMENTS (intent context; not separate criteria):");
    for (const c of comments)
      intentLines.push(`  - ${c.author ?? "someone"}: ${trim(c.text.trim(), MAX_COMMENT_CHARS)}`);
  }

  const diffLines: string[] = hunks.map(
    (h) => `${h.id} (file: ${h.file} ${h.header})\n${h.body.trimEnd()}`,
  );

  const context = [
    "[INTENT - the stated goal of this change; the ONLY intent you may judge against]",
    ...intentLines,
    "[END INTENT]",
    "",
    "[DIFF - the actual code change; cite a hunk's [H#] when a criterion is addressed by it]",
    ...(diffLines.length ? diffLines : ["(no diff hunks)"]),
    inputs.diff?.truncated ? "(diff truncated - later hunks not shown)" : "",
    "[END DIFF]",
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { criteria, hunks, context, caveats };
}

// ---- model call + deterministic parse/suppression ----------------------------------------------

async function complete(deps: CoverageDeps, context: string): Promise<string> {
  const parts: string[] = [];
  for await (const ev of deps.llm.complete({
    system: COVERAGE_SYSTEM,
    messages: [{ role: "user", content: context }],
    maxTokens: deps.maxTokens ?? 1_400,
    // Deterministic judgment, not prose warmth - keep the reviewer sober and repeatable.
    temperature: 0,
    thinking: true, // reason before judging (single-turn -> safe)
  })) {
    if (ev.type === "token") parts.push(ev.text);
  }
  return parts.join("");
}

const LINE_RE =
  /^\s*\[(AC\d+)\]\s*status\s*=\s*(implemented|possibly-missing|cannot-tell)\b(.*?)::\s*(.+?)\s*$/i;
const CITE_RE = /\[(AC\d+|H\d+)\]/gi;

interface ParsedLine {
  acId: string;
  status: CriterionStatus;
  cites: string[];
  note: string;
}

/** Parse the model's per-criterion lines. Anything off-format is ignored (not trusted). */
export function parseCoverageLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = LINE_RE.exec(raw);
    if (!m) continue;
    const acId = (m[1] ?? "").toUpperCase();
    const status = (m[2] ?? "").toLowerCase() as CriterionStatus;
    const cites = [...(m[3] ?? "").matchAll(CITE_RE)].map((c) => (c[1] ?? "").toUpperCase());
    out.push({ acId, status, cites, note: (m[4] ?? "").trim() });
  }
  return out;
}

/** Everything after the last per-criterion line = the SUMMARY paragraph (best effort). */
function extractSummary(text: string): string {
  const idx = text.search(/summary\s*[:.]/i);
  if (idx >= 0)
    return text
      .slice(idx)
      .replace(/^summary\s*[:.]?\s*/i, "")
      .trim();
  // Fallback: the trailing prose after the last matched criterion line.
  const lines = text.split(/\r?\n/);
  let lastLine = -1;
  lines.forEach((l, i) => {
    if (LINE_RE.test(l)) lastLine = i;
  });
  return lines
    .slice(lastLine + 1)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Apply the deterministic suppression gate (the precision mechanism). Binds the model's markers to
 * the real criteria/hunks and DOWNGRADES any claim it can't structurally support:
 *   - implemented with no valid diff-hunk citation -> cannot-tell (can't claim done without code);
 *   - possibly-missing for an unknown/invented criterion -> dropped (can't fabricate a gap);
 *   - a criterion the model never addressed -> stays cannot-tell (never silently "implemented").
 */
function applyJudgments(
  criteria: CoverageCriterion[],
  hunks: DiffHunk[],
  parsed: ParsedLine[],
  issue: IntentIssue,
): void {
  const byId = new Map(criteria.map((c) => [c.id, c]));
  const hunkById = new Map(hunks.map((h) => [h.id, h]));
  const seen = new Set<string>();

  for (const p of parsed) {
    const criterion = byId.get(p.acId);
    if (!criterion || seen.has(p.acId)) continue; // invented criterion or duplicate line -> ignore
    seen.add(p.acId);

    const hunkCites = p.cites
      .filter((c) => c.startsWith("H"))
      .map((c) => hunkById.get(c))
      .filter((h): h is DiffHunk => Boolean(h));

    let status = p.status;
    let note = p.note;
    const citations: CoverageCitation[] = [];

    if (status === "implemented") {
      if (hunkCites.length === 0) {
        // No code to point at -> we cannot assert it's built. Downgrade honestly.
        status = "cannot-tell";
        note = note
          ? `${note} (No specific code location was cited, so this can't be confirmed.)`
          : "Reported as implemented, but no specific code location was cited, so it can't be confirmed.";
      } else {
        for (const h of hunkCites)
          citations.push({ marker: h.id, kind: "diff-hunk", ref: `${h.file} ${h.header}` });
      }
    }

    if (status === "possibly-missing") {
      // Always anchored to its own criterion (the line prefix), independent of what the model cited.
      citations.push({
        marker: criterion.id,
        kind: "acceptance-criterion",
        ref: criterion.text,
        ...(issue.url ? { url: issue.url } : {}),
      });
      // A possibly-missing that also cited hunks (the model found related but insufficient code)
      // keeps those as supporting references.
      for (const h of hunkCites)
        citations.push({ marker: h.id, kind: "diff-hunk", ref: `${h.file} ${h.header}` });
    }

    criterion.status = status;
    criterion.note = note || fallbackNote(status, criterion);
    criterion.citations = citations;
  }

  // Unaddressed criteria stay cannot-tell with an honest default note.
  for (const c of criteria) if (!seen.has(c.id) && !c.note) c.note = fallbackNote("cannot-tell", c);
}

function fallbackNote(status: CriterionStatus, c: CoverageCriterion): string {
  if (status === "implemented") return "Appears addressed by the cited change.";
  if (status === "possibly-missing")
    return `I don't see this addressed in the diff - was "${trim(c.text, 80)}" handled elsewhere?`;
  return "Couldn't determine from the diff whether this is addressed.";
}

function summarise(criteria: CoverageCriterion[], modelSummary: string): string {
  const impl = criteria.filter((c) => c.status === "implemented").length;
  const miss = criteria.filter((c) => c.status === "possibly-missing").length;
  const unk = criteria.filter((c) => c.status === "cannot-tell").length;
  const head = `${impl} of ${criteria.length} acceptance criteria appear addressed by this diff${
    miss ? `; ${miss} look${miss === 1 ? "s" : ""} worth a closer look` : ""
  }${unk ? `; ${unk} couldn't be judged from the diff alone` : ""}.`;
  return modelSummary ? `${head} ${modelSummary}` : head;
}

/**
 * Judge intent coverage for a PR against its linked issue. Pure + model-agnostic: pass an assembled
 * `CoverageInputs` and an `LLMProvider`. Honest states short-circuit before the model:
 *   - no linked issue -> `no-intent` (not a failure - there is simply no stated intent to check);
 *   - no diff available -> `no-diff`.
 */
export async function judgeCoverage(
  deps: CoverageDeps,
  inputs: CoverageInputs,
): Promise<CoverageAssessment> {
  const base = {
    pr: inputs.pr,
    reviewNote: REVIEW_NOTE,
    criteria: [] as CoverageCriterion[],
    caveats: [] as string[],
  };
  if (!inputs.issue) {
    return {
      ...base,
      status: "no-intent",
      issue: null,
      summary:
        "This PR has no linked Jira issue, so there's no stated intent to check its coverage against. Link a ticket (or reference its key in the PR) to enable an intent-coverage review.",
    };
  }
  const issue = inputs.issue;
  const issueRef = { id: issue.id, key: issue.key, url: issue.url, summary: issue.summary };
  if (!inputs.diff || !inputs.diff.text.trim()) {
    return {
      ...base,
      status: "no-diff",
      issue: issueRef,
      summary: `The diff for this PR isn't available, so its coverage of ${issue.key} can't be checked right now.`,
    };
  }

  const prep = prepare(inputs, issue, inputs.diff.text);
  const raw = await complete(deps, prep.context);
  const parsed = parseCoverageLines(raw);
  applyJudgments(prep.criteria, prep.hunks, parsed, issue);

  return {
    status: "assessed",
    pr: inputs.pr,
    issue: issueRef,
    criteria: prep.criteria,
    summary: summarise(prep.criteria, extractSummary(raw)),
    caveats: prep.caveats,
    reviewNote: REVIEW_NOTE,
  };
}
