/**
 * Atlassian Document Format → plain text. Jira Cloud v3 returns rich text (description, comments)
 * as ADF — a nested JSON doc of `{ type, content, text }` nodes. The intent-coverage judge needs
 * readable text, not ADF, so we recursively collect `text` leaves, insert breaks at block
 * boundaries, and render list items with a bullet. Best-effort + bounded (never throws; caps size).
 */

const MAX_TEXT = 8_000;

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
}

const BLOCK = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "rule",
  "listItem",
  "tableRow",
]);

export function adfToText(doc: unknown): string {
  if (typeof doc === "string") return doc.trim().slice(0, MAX_TEXT);
  if (!doc || typeof doc !== "object") return "";
  const out: string[] = [];
  walk(doc as AdfNode, out);
  return out
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);
}

function walk(node: AdfNode, out: string[]): void {
  if (!node || typeof node !== "object") return;
  if (typeof node.text === "string") out.push(node.text);
  if (node.type === "listItem") out.push("• ");
  for (const child of node.content ?? []) walk(child, out);
  if (node.type && BLOCK.has(node.type)) out.push("\n");
}

/** Strip HTML tags (for `renderedFields` fallbacks) → collapsed text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);
}
