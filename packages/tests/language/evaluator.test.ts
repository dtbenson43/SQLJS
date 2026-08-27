import { describe, expect, it } from "vitest";
import { evaluateExpression, EvaluationError, isSqlTrue } from "../../language/evaluator";
import { Lexer } from "../../language/lexer";
import { Parser } from "../../language/parser";

function expression(sql: string) {
  const program = new Parser(new Lexer(`SELECT ${sql} FROM Elements`).tokenize()).parse();
  const statement = program.statements[0]!;
  if (statement.type !== "select" || statement.columns[0]!.type !== "column") throw new Error("Expected expression column");
  return statement.columns[0]!.expr;
}

describe("expression evaluator", () => {
  it("resolves columns and nested property paths case-insensitively", () => {
    expect(evaluateExpression(expression("tag"), { row: { TAG: "button" } })).toBe("button");
    expect(evaluateExpression(expression("style.color"), { row: { style: { color: "red" } } })).toBe("red");
  });

  it("evaluates comparisons, arithmetic, and LIKE wildcards", () => {
    const row = { tag: "button", text: "Hello", value: "4" };
    expect(evaluateExpression(expression("tag = 'button' AND text LIKE 'He%'"), { row })).toBe(true);
    expect(evaluateExpression(expression("CAST(value AS INT) + 1"), { row })).toBe(5);
    expect(evaluateExpression(expression("text NOT LIKE '%error%'"), { row })).toBe(true);
  });

  it("uses SQL three-valued logic for NULL", () => {
    expect(evaluateExpression(expression("missing = 1"), { row: {} })).toBeNull();
    expect(evaluateExpression(expression("missing IS NULL"), { row: {} })).toBe(true);
    expect(evaluateExpression(expression("missing = 1 OR tag = 'button'"), { row: { tag: "button" } })).toBe(true);
    expect(evaluateExpression(expression("missing = 1 AND tag = 'button'"), { row: { tag: "button" } })).toBeNull();
    expect(isSqlTrue(null)).toBe(false);
  });

  it("supports built-in functions and parameters", () => {
    const context = { row: { text: "Hello" }, params: { username: "Ada" } };
    expect(evaluateExpression(expression("LEN(text)"), context)).toBe(5);
    expect(evaluateExpression(expression("LOWER(text)"), context)).toBe("hello");
    expect(evaluateExpression(expression("$username"), context)).toBe("Ada");
    expect(evaluateExpression(expression("COALESCE(missing, text)"), context)).toBe("Hello");
  });

  it("evaluates OLD and NEW trigger references", () => {
    expect(evaluateExpression(expression("NEW.value"), { new: { value: "new" } })).toBe("new");
    expect(evaluateExpression(expression("OLD.value != NEW.value"), { old: { value: "old" }, new: { value: "new" } })).toBe(true);
  });

  it("rejects invalid numeric operations and unknown functions", () => {
    expect(() => evaluateExpression(expression("1 / 0"))).toThrow(EvaluationError);
    expect(() => evaluateExpression(expression("NOPE(1)"))).toThrow("Unknown function");
  });
});
