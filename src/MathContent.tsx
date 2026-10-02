import katex from "katex";
import { Fragment, type ReactNode } from "react";
import "katex/dist/katex.min.css";

type MathPart = { value: string; math: boolean; display?: boolean };

function renderMath(value: string, display = false): string {
  try {
    return katex.renderToString(normalizeMath(value), {
      displayMode: display,
      throwOnError: false,
      strict: "ignore",
      trust: false,
      output: "htmlAndMathml",
    });
  } catch {
    return value;
  }
}

function normalizeMath(value: string): string {
  return value
    .replace(/\\?log\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)\s*\(([^()]+)\)/gi, "\\log_{\\frac{$1}{$2}}\\left($3\\right)")
    .replace(/\bsqrt\s*\(([^()]+)\)/gi, "\\sqrt{$1}")
    .replace(/√\s*([A-Za-z0-9]+|\([^()]+\))/g, "\\sqrt{$1}")
    .replace(/([A-Za-z])([23])(?=$|[^A-Za-z0-9])/g, "$1^$2")
    .replace(/([A-Za-z])_([A-Za-z0-9]+)/g, "$1_{$2}")
    .replace(/<=/g, "\\le ")
    .replace(/>=/g, "\\ge ")
    .replace(/!=/g, "\\ne ")
    .replace(/×/g, "\\times ")
    .replace(/÷/g, "\\div ")
    .replace(/−/g, "-");
}

function splitParts(value: string): MathPart[] {
  const trimmed = value.trim();
  if (/^\\(?:log|ln|exp|sqrt|frac|sin|cos|tan|pi|alpha|beta|gamma|delta|theta|lambda|sigma|phi|omega|sum|int|lim|cdot|times|ge|le|neq|infty)\b/i.test(trimmed)) {
    return [{ value: trimmed, math: true }];
  }
  const parts: MathPart[] = [];
  const pattern = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+\$|\\begin\{(?:align\*?|equation\*?|gather\*?)\}[\s\S]+?\\end\{(?:align\*?|equation\*?|gather\*?)\}|(?:\\?log\s*\(\s*\d+\s*\/\s*\d+\s*\)\s*\([^()\n]+\)(?:\s*[<>=≤≥]+\s*[^,\n]+)?|[A-Za-z0-9_πθαβγδλμσφω]+(?:\s*[+\-*/=<>≤≥^]\s*[A-Za-z0-9_πθ αβγδλμσφω().]+)+(?:\s*[<>=≤≥]+\s*[A-Za-z0-9.]+)?|[A-Za-z0-9]+\s*\/\s*[A-Za-z0-9]+|√\s*[A-Za-z0-9]+))/g;
  let lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push({ value: value.slice(lastIndex, index), math: false });
    const token = match[0];
    const display = token.startsWith("$$") || token.startsWith("\\[") || token.startsWith("\\begin{");
    const explicit = display || token.startsWith("$") || token.startsWith("\\(") || token.startsWith("\\[") || token.startsWith("\\begin{");
    const latex = token.startsWith("$$") ? token.slice(2, -2)
      : token.startsWith("$") ? token.slice(1, -1)
        : token.startsWith("\\(") ? token.slice(2, -2)
          : token.startsWith("\\[") ? token.slice(2, -2)
            : token.startsWith("\\begin{") ? token : normalizeMath(token);
    parts.push({ value: latex, math: true, display });
    lastIndex = index + token.length;
    if (explicit) continue;
  }
  if (lastIndex < value.length) parts.push({ value: value.slice(lastIndex), math: false });
  return parts;
}

function InlineMath({ text }: { text: string }) {
  return <>{splitParts(text).map((part, index) => part.math
    ? <span key={index} className={part.display ? "math-display" : "math-inline"} dangerouslySetInnerHTML={{ __html: renderMath(part.value, part.display) }} />
    : <Fragment key={index}>{part.value}</Fragment>)}</>;
}

function formattedLine(line: string): ReactNode[] {
  const pieces: ReactNode[] = [];
  const boldPattern = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  for (const match of line.matchAll(boldPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) pieces.push(<InlineMath key={`text-${lastIndex}`} text={line.slice(lastIndex, index)} />);
    pieces.push(<strong key={`bold-${index}`}><InlineMath text={match[1]} /></strong>);
    lastIndex = index + match[0].length;
  }
  if (lastIndex < line.length) pieces.push(<InlineMath key={`text-${lastIndex}`} text={line.slice(lastIndex)} />);
  return pieces;
}

export function MathContent({ text, className = "" }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n?/g, "\n")
    .replace(/([.!?])\s+(?=(?:[A-Z]|\*\*(?:Step|Final|Answer|Solution)\b))/g, "$1\n")
    .split("\n");
  return <div className={`math-content ${className}`.trim()}>
    {lines.map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return <div className="math-spacer" key={`space-${index}`} aria-hidden="true" />;
      const semanticLine = trimmed.replace(/^\*\*|\*\*$/g, "");
      const heading = /^(?:solution|step\s+\d+\s*:|final answer\s*:|answer\s*:)/i.test(semanticLine);
      const final = /^(?:final answer|answer)\s*:/i.test(semanticLine);
      return <p key={`line-${index}`} className={`${heading ? "solution-step-heading" : ""} ${final ? "solution-final-answer" : ""}`.trim()}>
        {formattedLine(trimmed)}
      </p>;
    })}
  </div>;
}

export function MathPreview({ label, text, className = "" }: { label: string; text: string; className?: string }) {
  return <div className={`math-preview ${className}`.trim()}><small>{label}</small><MathContent text={text || "Your mathematical preview will appear here."} /></div>;
}
