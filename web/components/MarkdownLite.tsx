// MarkdownLite — a tiny, dependency-free markdown renderer.
//
// We deliberately avoid pulling in `react-markdown` (and its transitive
// deps) for a case-study demo.  This supports the subset the platform
// actually authors content in:
//
//   # / ## / ### headings
//   **bold**, *italic*, `inline code`
//   ```fenced code blocks```  (optionally with a language label)
//   - / * bullet lists, 1. numbered lists
//   > blockquotes
//   blank-line-separated paragraphs
//
// Anything it doesn't recognise is rendered as plain text, so it can
// never crash on unexpected input.

import { Fragment, type ReactNode } from "react";

function renderInline(text: string, keyBase: string): ReactNode[] {
  // Split on the inline tokens we support while keeping the delimiters.
  // Order matters: code first so `**` inside backticks is left alone.
  const out: ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) out.push(<Fragment key={`${keyBase}-t${i}`}>{text.slice(last, m.index)}</Fragment>);
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(
        <code key={`${keyBase}-c${i}`} className="rounded bg-bg px-1.5 py-0.5 font-mono text-[0.85em] text-accent">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      out.push(<strong key={`${keyBase}-b${i}`} className="font-semibold text-white">{tok.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={`${keyBase}-i${i}`}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) out.push(<Fragment key={`${keyBase}-tEnd`}>{text.slice(last)}</Fragment>);
  return out;
}

interface Block {
  type: "p" | "h1" | "h2" | "h3" | "ul" | "ol" | "code" | "quote";
  lines: string[];
  lang?: string;
}

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || undefined;
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
      i++; // consume closing fence
      blocks.push({ type: "code", lines: body, lang });
      continue;
    }

    // Blank line — paragraph separator.
    if (line.trim() === "") { i++; continue; }

    // Headings.
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const t = (h[1].length === 1 ? "h1" : h[1].length === 2 ? "h2" : "h3") as Block["type"];
      blocks.push({ type: t, lines: [h[2]] });
      i++;
      continue;
    }

    // Blockquote.
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { body.push(lines[i].replace(/^>\s?/, "")); i++; }
      blocks.push({ type: "quote", lines: body });
      continue;
    }

    // Unordered list.
    if (/^\s*[-*]\s+/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { body.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++; }
      blocks.push({ type: "ul", lines: body });
      continue;
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { body.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      blocks.push({ type: "ol", lines: body });
      continue;
    }

    // Paragraph — consume consecutive non-blank, non-special lines.
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i]) &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i])
    ) { body.push(lines[i]); i++; }
    blocks.push({ type: "p", lines: body });
  }
  return blocks;
}

export default function MarkdownLite({ source, className = "" }: { source: string; className?: string }) {
  const blocks = parse(source ?? "");
  return (
    <div className={"space-y-3 text-sm leading-7 " + className}>
      {blocks.map((b, bi) => {
        const key = `b${bi}`;
        switch (b.type) {
          case "h1":
            return <h2 key={key} className="text-lg font-semibold text-white">{renderInline(b.lines[0], key)}</h2>;
          case "h2":
            return <h3 key={key} className="text-base font-semibold text-white">{renderInline(b.lines[0], key)}</h3>;
          case "h3":
            return <h4 key={key} className="text-sm font-semibold text-white">{renderInline(b.lines[0], key)}</h4>;
          case "code":
            return (
              <pre key={key} className="overflow-x-auto rounded border border-border bg-bg p-3 font-mono text-xs leading-6">
                {b.lang && <div className="mb-1 select-none text-[10px] uppercase tracking-wider text-muted">{b.lang}</div>}
                <code>{b.lines.join("\n")}</code>
              </pre>
            );
          case "quote":
            return (
              <blockquote key={key} className="border-l-2 border-accent/50 pl-3 text-muted">
                {b.lines.map((l, li) => <p key={li}>{renderInline(l, `${key}-${li}`)}</p>)}
              </blockquote>
            );
          case "ul":
            return (
              <ul key={key} className="list-disc space-y-1 pl-5">
                {b.lines.map((l, li) => <li key={li}>{renderInline(l, `${key}-${li}`)}</li>)}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="list-decimal space-y-1 pl-5">
                {b.lines.map((l, li) => <li key={li}>{renderInline(l, `${key}-${li}`)}</li>)}
              </ol>
            );
          default:
            return <p key={key}>{b.lines.map((l, li) => <Fragment key={li}>{li > 0 && " "}{renderInline(l, `${key}-${li}`)}</Fragment>)}</p>;
        }
      })}
    </div>
  );
}
