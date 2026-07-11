import * as React from "react";

/**
 * A small, self-contained markdown renderer for the War Room verdict (docs/plans/war-room.md). The
 * diagnose loop returns markdown — headings, bold, inline code, lists — plus `[E1]`/`[N3]` citation
 * markers. We render those properly (not as raw `###`/`**`) without pulling in a full markdown lib or
 * the Ask-chat citation-peek machinery. Citation markers become quiet superscript chips.
 */
export function MarkdownLite({ text }: { text: string }) {
  const blocks = React.useMemo(() => toBlocks(text), [text]);
  return <div className="space-y-2.5 text-sm leading-relaxed text-foreground/90">{blocks}</div>;
}

type Block = React.ReactNode;

function toBlocks(text: string): Block[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      out.push(
        <p key={key++} className="text-foreground/90">
          {renderInline(para.join(" "))}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      out.push(
        <ul key={key++} className="ml-1 space-y-1">
          {list.map((li, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" />
              <span>{renderInline(li)}</span>
            </li>
          ))}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushList();
      flushPara();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      flushPara();
      const level = (heading[1] ?? "").length;
      out.push(
        <p
          key={key++}
          className={
            level <= 2
              ? "pt-1 text-sm font-semibold text-foreground"
              : "pt-0.5 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground"
          }
        >
          {renderInline(heading[2] ?? "")}
        </p>,
      );
      continue;
    }
    const li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      list.push(li[1] ?? "");
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushList();
  flushPara();
  return out;
}

/** Inline: **bold**, `code`, and `[E1]`/`[N3]` citation markers. */
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[A-Za-z]?\d+\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(
        <strong key={i++} className="font-semibold text-foreground">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("`")) {
      parts.push(
        <code
          key={i++}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      parts.push(
        <sup
          key={i++}
          className="ml-0.5 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground"
        >
          {tok.slice(1, -1)}
        </sup>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
