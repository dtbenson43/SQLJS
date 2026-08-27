import { describe, expect, it } from "vitest";
import { Lexer } from "../../language/lexer";
import { Parser } from "../../language/parser";
import { evaluateExpression } from "../../language/evaluator";
import { compile, compileExpr, compileExpression, compileProgram } from "../../compiler";
import { sql } from "../../runtime/sql";
import { domsql } from "../../runtime/api";
import { execute, QueryResult } from "../../runtime/execute";
import { serializeDom, domSnapshotsEqual } from "../../runtime/dom-snapshot";
import { makeMockDoc, MockDocument } from "../helpers/mock-dom";

function parseExpression(source: string) {
  const program = new Parser(new Lexer("SELECT " + source + " FROM Elements").tokenize()).parse();
  const stmt = program.statements[0]!;
  if (stmt.type !== "select" || stmt.columns[0]!.type !== "column") {
    throw new Error("Expected an expression column");
  }
  return stmt.columns[0]!.expr;
}

/** Evaluate a compiled expression source string against a context. */
function evalCompiled(exprSource: string, ctx: Record<string, unknown>): unknown {
  const fn = Function("runtime", "ctx", "return " + exprSource);
  return fn(sql, ctx);
}

function buildDoc(): MockDocument {
  const doc = makeMockDoc();
  const div = doc.createElement("DIV");
  div.id = "app";
  div.textContent = "Hello";
  div.className = "title";
  doc.body!.appendChild(div);

  const btn = doc.createElement("BUTTON");
  btn.id = "save";
  btn.textContent = "Save";
  btn.className = "primary";
  btn.disabled = false;
  doc.body!.appendChild(btn);

  const input = doc.createElement("INPUT");
  input.id = "username";
  input.value = "alice";
  doc.body!.appendChild(input);

  return doc;
}

describe("expression compiler", () => {
  function expectSameAsInterpreter(source: string, ctx: Record<string, unknown>) {
    const expr = parseExpression(source);
    const interpreted = evaluateExpression(expr, { row: ctx.row as any, params: ctx.params as Record<string, unknown> | undefined, old: ctx.old as any, new: ctx.new as any });
    const compiledSource = compileExpr(expr);
    const compiled = evalCompiled(compiledSource, ctx);
    expect(compiled).toEqual(interpreted);
  }

  it("compiles literals and column references", () => {
    expectSameAsInterpreter("'button'", {});
    expectSameAsInterpreter("42", {});
    expectSameAsInterpreter("tag", { row: { tag: "BUTTON" } });
  });

  it("compiles comparisons and arithmetic", () => {
    expectSameAsInterpreter("value + 1", { row: { value: "4" } });
    expectSameAsInterpreter("CAST(text AS INT) * 2", { row: { text: "3" } });
    expectSameAsInterpreter("tag = 'button'", { row: { tag: "button" } });
    expectSameAsInterpreter("value >= 10", { row: { value: "12" } });
  });

  it("compiles AND/OR with short-circuiting", () => {
    expectSameAsInterpreter("tag = 'button' AND disabled = false", { row: { tag: "button", disabled: false } });
    expectSameAsInterpreter("tag = 'button' OR disabled = true", { row: { tag: "button", disabled: false } });
  });

  it("compiles LIKE and IS NULL", () => {
    expectSameAsInterpreter("class LIKE '%error%'", { row: { class: "error-box" } });
    expectSameAsInterpreter("text IS NULL", { row: {} });
    expectSameAsInterpreter("text IS NOT NULL", { row: { text: "x" } });
  });

  it("compiles functions and parameters", () => {
    expectSameAsInterpreter("LEN(text)", { row: { text: "Hello" } });
    expectSameAsInterpreter("UPPER(text)", { row: { text: "hello" } });
    expectSameAsInterpreter("COALESCE(missing, text)", { row: { text: "fallback" } });
    expectSameAsInterpreter("$username", { params: { username: "Ada" } });
  });

  it("compiles OLD/NEW references", () => {
    expectSameAsInterpreter("NEW.value", { new: { value: "bob" } });
    expectSameAsInterpreter("OLD.value != NEW.value", { old: { value: "alice" }, new: { value: "bob" } });
  });

  it("emits a closure over the evaluation context", () => {
    const expr = parseExpression("tag = 'button'");
    const closureSource = compileExpression(expr);
    const closure = Function("runtime", "return " + closureSource)(sql) as (ctx: unknown) => unknown;
    expect(closure({ row: { tag: "button" } })).toBe(true);
    expect(closure({ row: { tag: "div" } })).toBe(false);
  });

  it("rejects aggregates in row expressions", () => {
    const expr = parseExpression("COUNT(*)");
    expect(() => compileExpr(expr)).toThrow(/aggregate/i);
  });
});

describe("differential testing (interpreter vs compiler)", () => {
  function runBoth(sql: string) {
    const docA = buildDoc();
    const docB = buildDoc();

    const interpreted = execute(sql, { root: docA as any });
    const code = compile(sql);
    const compiledFn = Function("return " + code)() as (runtime: unknown, root: unknown, params?: Record<string, unknown>) => unknown;
    const compiled = compiledFn(domsql, docB, {}) as QueryResult;

    return {
      interpreted,
      compiled,
      snapshotA: serializeDom(docA as any),
      snapshotB: serializeDom(docB as any),
    };
  }

  it("produces identical DOM for UPDATE", () => {
    const { interpreted, compiled, snapshotA, snapshotB } = runBoth(
      "UPDATE FROM Elements SET text = 'Goodbye' WHERE class LIKE '%title%'"
    );
    expect(compiled.affectedRows).toBe(interpreted.affectedRows);
    expect(domSnapshotsEqual(snapshotA, snapshotB)).toBe(true);
  });

  it("produces identical DOM for INSERT", () => {
    const { interpreted, compiled, snapshotA, snapshotB } = runBoth(
      "INSERT INTO #app (tag, class, text) VALUES ('p', 'message', 'Created from SQL')"
    );
    expect(compiled.affectedRows).toBe(interpreted.affectedRows);
    expect(domSnapshotsEqual(snapshotA, snapshotB)).toBe(true);
  });

  it("produces identical DOM for DELETE", () => {
    const { interpreted, compiled, snapshotA, snapshotB } = runBoth(
      "DELETE FROM Elements WHERE id = 'save'"
    );
    expect(compiled.affectedRows).toBe(interpreted.affectedRows);
    expect(domSnapshotsEqual(snapshotA, snapshotB)).toBe(true);
  });

  it("produces identical SELECT rows", () => {
    const { interpreted, compiled } = runBoth(
      "SELECT id, tag, text FROM Elements WHERE tag = 'BUTTON'"
    );
    expect(compiled.rows).toEqual(interpreted.rows);
    expect(compiled.columns).toEqual(interpreted.columns);
  });

  it("produces identical DOM for transactions", () => {
    const { interpreted, compiled, snapshotA, snapshotB } = runBoth(
      "BEGIN TRANSACTION; UPDATE FROM Elements SET text = 'Changed' WHERE id = 'app'; ROLLBACK"
    );
    expect(domSnapshotsEqual(snapshotA, snapshotB)).toBe(true);
    expect(compiled.affectedRows).toBe(interpreted.affectedRows);
  });

  it("produces identical DOM for mutation triggers", () => {
    const sql = [
      "CREATE TRIGGER t1 ON #username AFTER UPDATE OF value AS BEGIN UPDATE #save SET text = NEW.value; END;",
      "UPDATE Elements SET value = 'bob' WHERE id = 'username';",
    ].join(" ");
    const { compiled, snapshotA, snapshotB } = runBoth(sql);
    expect(domSnapshotsEqual(snapshotA, snapshotB)).toBe(true);
  });
});
