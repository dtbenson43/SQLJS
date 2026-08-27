import { describe, expect, it } from "vitest";
import { buildPreviewDocument, DEFAULT_HTML, parseProgram, selectedSql } from "../../playground";

describe("playground model helpers", () => {
  it("builds an isolated preview document", () => {
    const source = buildPreviewDocument("<p>Hello</p>", "p { color: red; }");
    expect(source).toContain("<style>p { color: red; }</style>");
    expect(source).toContain("<body><p>Hello</p></body>");
  });

  it("escapes a closing style tag in user CSS", () => {
    const source = buildPreviewDocument("", "x { content: '</style><script>'; }");
    expect(source).not.toMatch(/<\/style><script>/i);
  });

  it("uses the whole editor when there is no selection", () => {
    expect(selectedSql("SELECT 1", null, null)).toBe("SELECT 1");
    expect(selectedSql("SELECT 1", 0, 0)).toBe("SELECT 1");
  });

  it("returns only the selected SQL when a non-empty selection exists", () => {
    const sql = "SELECT 1;\nUPDATE #app SET text = 'ok';";
    expect(selectedSql(sql, 10, sql.length)).toBe("UPDATE #app SET text = 'ok';");
  });

  it("parses valid SQL and exposes diagnostics for invalid SQL", () => {
    expect(parseProgram("SELECT * FROM Elements").program?.statements).toHaveLength(1);
    const invalid = parseProgram("SELECT FROM");
    expect(invalid.program).toBeUndefined();
    expect(invalid.diagnostics.length).toBeGreaterThan(0);
  });

  it("provides the documented default HTML", () => {
    expect(DEFAULT_HTML).toContain('<div id="app">');
  });
});
