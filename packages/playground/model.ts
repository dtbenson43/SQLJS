import { Lexer } from "../language/lexer";
import { Parser } from "../language/parser";
import { ParseError } from "../language/errors";
import { Program } from "../language/ast";

export const DEFAULT_HTML = `<div id="app">
  <h1 class="title">Hello</h1>
  <button id="change">Change Me</button>
</div>`;

export const DEFAULT_CSS = `body { font-family: system-ui, sans-serif; padding: 1rem; }
.title { color: #334155; }`;

export const DEFAULT_SQL = `SELECT id, tag, text
FROM Elements;

UPDATE Elements
SET text = 'Goodbye'
WHERE class LIKE '%title%';

INSERT INTO #app (tag, class, text)
VALUES ('p', 'message', 'Created from SQL');

DELETE FROM Elements
WHERE id = 'change';`;

export interface PlaygroundSource {
  sql: string;
  html: string;
  css: string;
}

export function buildPreviewDocument(html: string, css: string): string {
  const safeCss = css.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${safeCss}</style></head><body>${html}</body></html>`;
}

export function selectedSql(sql: string, start: number | null, end: number | null): string {
  if (start === null || end === null || start === end) return sql;
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const selection = sql.slice(from, to).trim();
  return selection || sql;
}

export function parseProgram(source: string): { program?: Program; diagnostics: string[] } {
  try {
    const program = new Parser(new Lexer(source).tokenize()).parse();
    return { program, diagnostics: [] };
  } catch (error) {
    if (error instanceof ParseError) {
      return { diagnostics: error.diagnostics.map((diagnostic) => {
        const location = `${diagnostic.line}:${diagnostic.column}`;
        return `${location} ${diagnostic.message}`;
      }) };
    }
    return { diagnostics: [error instanceof Error ? error.message : String(error)] };
  }
}
