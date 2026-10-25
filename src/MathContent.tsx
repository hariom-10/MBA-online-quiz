import katex from "katex";
import { Fragment, useState, type ReactNode } from "react";
import { Maximize2, X, ZoomIn } from "lucide-react";
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

function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.includes("|");
}

function isSeparatorLine(line: string): boolean {
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(line.trim());
}

function renderTable(tableLines: string[], keyPrefix: string): ReactNode {
  const cleanRows = tableLines.filter((l) => !isSeparatorLine(l));
  if (cleanRows.length === 0) return null;

  const headerCells = cleanRows[0].split("|").slice(1, -1).map((c) => c.trim());
  const bodyRows = cleanRows.slice(1).map((row) => row.split("|").slice(1, -1).map((c) => c.trim()));

  return (
    <div key={keyPrefix} className="math-table-container">
      <table className="math-table">
        {headerCells.length > 0 && (
          <thead>
            <tr>
              {headerCells.map((cell, idx) => (
                <th key={`${keyPrefix}-th-${idx}`}>{formattedLine(cell)}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {bodyRows.map((cells, rowIdx) => (
            <tr key={`${keyPrefix}-tr-${rowIdx}`}>
              {cells.map((cell, cellIdx) => (
                <td key={`${keyPrefix}-td-${rowIdx}-${cellIdx}`}>{formattedLine(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MathContent({ text, className = "" }: { text: string; className?: string }) {
  if (!text) return null;

  // Split into raw lines while preserving empty lines for paragraph separation
  const rawLines = text.replace(/\r\n?/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let tableBuffer: string[] = [];
  let paragraphBuffer: string[] = [];

  const flushTable = () => {
    if (tableBuffer.length > 0) {
      nodes.push(renderTable(tableBuffer, `table-${nodes.length}`));
      tableBuffer = [];
    }
  };

  const flushParagraph = () => {
    if (paragraphBuffer.length > 0) {
      const pText = paragraphBuffer.join("\n").trim();
      if (pText) {
        const semanticText = pText.replace(/^\*\*|\*\*$/g, "");
        const heading = /^(?:solution|step\s+\d+\s*:|final answer\s*:|answer\s*:|directions?\s*(?:for\s+questions?)?\s*[:\d])/i.test(semanticText);
        const final = /^(?:final answer|answer)\s*:/i.test(semanticText);
        const isDirection = /^directions?\s*(?:for\s+questions?)?\s*[:\d]/i.test(semanticText);

        nodes.push(
          <div
            key={`p-${nodes.length}`}
            className={`math-paragraph ${heading ? "solution-step-heading" : ""} ${final ? "solution-final-answer" : ""} ${isDirection ? "question-direction-box" : ""}`.trim()}
          >
            {paragraphBuffer.map((line, lIdx) => (
              <Fragment key={`line-${lIdx}`}>
                {lIdx > 0 && <br />}
                {formattedLine(line)}
              </Fragment>
            ))}
          </div>
        );
      }
      paragraphBuffer = [];
    }
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    // Check for images
    const imgMatch = trimmed.match(/^!\[(.*?)\]\((.*?)\)$/);
    if (imgMatch) {
      flushParagraph();
      flushTable();
      nodes.push(<QuestionGraphViewer key={`img-${nodes.length}`} alt={imgMatch[1]} imageUrl={imgMatch[2]} />);
      continue;
    }

    // Check for table lines
    if (isTableLine(line)) {
      flushParagraph();
      tableBuffer.push(line);
      continue;
    } else if (tableBuffer.length > 0) {
      flushTable();
    }

    // Blank line indicates paragraph boundary
    if (!trimmed) {
      flushParagraph();
      nodes.push(<div className="math-spacer" key={`space-${nodes.length}`} aria-hidden="true" />);
      continue;
    }

    paragraphBuffer.push(line);
  }

  flushTable();
  flushParagraph();

  return <div className={`math-content ${className}`.trim()}>{nodes}</div>;
}

export function QuestionGraphViewer({
  imageUrl,
  alt = "Question Diagram or Graph",
  caption,
}: {
  imageUrl: string;
  alt?: string;
  caption?: string;
}) {
  const [zoomOpen, setZoomOpen] = useState(false);

  if (!imageUrl) return null;

  return (
    <div className="question-graph-container">
      <div className="question-graph-frame" onClick={() => setZoomOpen(true)}>
        <img src={imageUrl} alt={alt} className="question-graph-img" />
        <div className="question-graph-overlay">
          <span><ZoomIn size={15} /> Click to enlarge graph</span>
        </div>
      </div>
      {caption && <small className="question-graph-caption">{caption}</small>}

      {zoomOpen && (
        <div className="graph-lightbox-overlay" onClick={() => setZoomOpen(false)}>
          <div className="graph-lightbox-card" onClick={(e) => e.stopPropagation()}>
            <div className="graph-lightbox-header">
              <span><Maximize2 size={16} /> {alt}</span>
              <button
                type="button"
                className="graph-lightbox-close"
                onClick={() => setZoomOpen(false)}
                aria-label="Close enlarged graph"
              >
                <X size={18} />
              </button>
            </div>
            <div className="graph-lightbox-body">
              <img src={imageUrl} alt={alt} className="graph-lightbox-img" />
            </div>
            <small className="graph-lightbox-hint">Click outside or press Close to return to question.</small>
          </div>
        </div>
      )}
    </div>
  );
}

export function MathPreview({ label, text, className = "" }: { label: string; text: string; className?: string }) {
  return <div className={`math-preview ${className}`.trim()}><small>{label}</small><MathContent text={text || "Your mathematical preview will appear here."} /></div>;
}
