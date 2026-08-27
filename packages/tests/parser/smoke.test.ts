// Smoke tests for the lexer -> parser -> formatter pipeline

import { describe, it, expect } from "vitest";
import { Lexer } from "../../language/lexer";
import { Parser } from "../../language/parser";
import { formatProgram } from "../../language/formatter";
import { ParseError } from "../../language/errors";
import { TokenKind } from "../../language/tokens";

describe("Lexer", () => {
  it("tokenizes SELECT * FROM Elements", () => {
    const lexer = new Lexer("SELECT * FROM Elements");
    const tokens = lexer.tokenize();
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).toEqual([
      TokenKind.SELECT,
      TokenKind.STAR,
      TokenKind.FROM,
      TokenKind.IDENTIFIER,
      TokenKind.EOF,
    ]);
  });

  it("tokenizes single-quoted strings", () => {
    const lexer = new Lexer("SELECT 'hello world'");
    const tokens = lexer.tokenize();
    expect(tokens[0]!.kind).toBe(TokenKind.SELECT);
    expect(tokens[1]!.kind).toBe(TokenKind.STRING);
    expect(tokens[1]!.value).toBe("hello world");
  });

  it("tokenizes escaped single quotes", () => {
    const lexer = new Lexer("SELECT 'it''s'");
    const tokens = lexer.tokenize();
    expect(tokens[1]!.value).toBe("it's");
  });

  it("tokenizes numbers (integer and decimal)", () => {
    const lexer = new Lexer("42 3.14");
    const tokens = lexer.tokenize();
    expect(tokens[0]!.kind).toBe(TokenKind.NUMBER);
    expect(tokens[0]!.value).toBe(42);
    expect(tokens[1]!.kind).toBe(TokenKind.NUMBER);
    expect(tokens[1]!.value).toBe(3.14);
  });

  it("tokenizes comparison operators", () => {
    const lexer = new Lexer("= != <> < <= > >=");
    const tokens = lexer.tokenize();
    expect(tokens[0]!.kind).toBe(TokenKind.EQ);
    expect(tokens[1]!.kind).toBe(TokenKind.NEQ);
    expect(tokens[2]!.kind).toBe(TokenKind.LTGT);
    expect(tokens[3]!.kind).toBe(TokenKind.LT);
    expect(tokens[4]!.kind).toBe(TokenKind.LTE);
    expect(tokens[5]!.kind).toBe(TokenKind.GT);
    expect(tokens[6]!.kind).toBe(TokenKind.GTE);
  });

  it("tokenizes keywords case-insensitively", () => {
    const lexer = new Lexer("select Select SELECT");
    const tokens = lexer.tokenize();
    expect(tokens[0]!.kind).toBe(TokenKind.SELECT);
    expect(tokens[1]!.kind).toBe(TokenKind.SELECT);
    expect(tokens[2]!.kind).toBe(TokenKind.SELECT);
  });

  it("handles element selectors with # and .", () => {
    const lexer = new Lexer("#app .counter");
    const tokens = lexer.tokenize();
    expect(tokens[0]!.kind).toBe(TokenKind.HASH);
    expect(tokens[1]!.kind).toBe(TokenKind.IDENTIFIER);
    expect(tokens[1]!.lexeme).toBe("app");
    expect(tokens[2]!.kind).toBe(TokenKind.DOT);
    expect(tokens[3]!.kind).toBe(TokenKind.IDENTIFIER);
    expect(tokens[3]!.lexeme).toBe("counter");
  });

  it("tokenizes parameter identifiers with $", () => {
    const lexer = new Lexer("UPDATE #user SET text = $username");
    const tokens = lexer.tokenize();
    const paramToken = tokens.find((t) => t.lexeme === "$username");
    expect(paramToken).toBeDefined();
    expect(paramToken!.kind).toBe(TokenKind.IDENTIFIER);
  });

  it("preserves exact source slice for string literals with escaped quotes", () => {
    const lexer = new Lexer("'it''s'");
    const tokens = lexer.tokenize();
    expect(tokens[0]!.lexeme).toBe("'it''s'");
    expect(tokens[0]!.length).toBe(7);
    expect(tokens[0]!.value).toBe("it's");
  });

  it("skips line comments", () => {
    const lexer = new Lexer("SELECT -- this is a comment\n42");
    const tokens = lexer.tokenize();
    expect(tokens[0]!.kind).toBe(TokenKind.SELECT);
    expect(tokens[1]!.kind).toBe(TokenKind.NUMBER);
  });

  it("skips block comments", () => {
    const lexer = new Lexer("SELECT /* block comment */ 42");
    const tokens = lexer.tokenize();
    expect(tokens[0]!.kind).toBe(TokenKind.SELECT);
    expect(tokens[1]!.kind).toBe(TokenKind.NUMBER);
  });
});

describe("Parser", () => {
  function parse(sql: string) {
    const lexer = new Lexer(sql);
    const parser = new Parser(lexer.tokenize());
    return parser.parse();
  }

  it("parses SELECT * FROM Elements", () => {
    const program = parse("SELECT * FROM Elements");
    expect(program.statements).toHaveLength(1);
    const stmt = program.statements[0]!;
    expect(stmt.type).toBe("select");
    if (stmt.type === "select") {
      expect(stmt.columns).toHaveLength(1);
      expect(stmt.columns[0]!.type).toBe("star");
      expect(stmt.source.type).toBe("global");
    }
  });

  it("parses SELECT with column list and accurate spans", () => {
    const program = parse("SELECT id, tag, text FROM Elements");
    const stmt = program.statements[0]!;
    expect(stmt.type).toBe("select");
    if (stmt.type === "select") {
      expect(stmt.columns).toHaveLength(3);
      // Column span should not be the SELECT keyword span
      expect(stmt.columns[0]!.span.start.column).toBe(8);
      expect(stmt.columns[1]!.span.start.column).toBe(12);
      expect(stmt.columns[2]!.span.start.column).toBe(17);
    }
  });

  it("parses SELECT with WHERE", () => {
    const program = parse("SELECT * FROM Elements WHERE tag = 'button'");
    const stmt = program.statements[0]!;
    expect(stmt.type).toBe("select");
    if (stmt.type === "select") {
      expect(stmt.where).toBeDefined();
      expect(stmt.where!.type).toBe("binary_expr");
    }
  });

  it("parses SELECT with AND/OR", () => {
    const program = parse(
      "SELECT * FROM Elements WHERE tag = 'button' AND disabled = false"
    );
    const stmt = program.statements[0]!;
    if (stmt.type === "select" && stmt.where && stmt.where.type === "binary_expr") {
      expect(stmt.where.operator).toBe("AND");
    }
  });

  it("parses UPDATE with SET (standard SQL without FROM)", () => {
    const program = parse(
      "UPDATE Elements SET text = 'Hello' WHERE id = 'message'"
    );
    const stmt = program.statements[0]!;
    expect(stmt.type).toBe("update");
    if (stmt.type === "update") {
      expect(stmt.assignments).toHaveLength(1);
      expect(stmt.assignments[0]!.target.segments[0]!.name).toBe("text");
      expect(stmt.source.type).toBe("global");
    }
  });

  it("parses UPDATE with optional FROM", () => {
    const program = parse(
      "UPDATE FROM Elements SET text = 'Hello' WHERE id = 'message'"
    );
    const stmt = program.statements[0]!;
    expect(stmt.type).toBe("update");
  });

  it("parses UPDATE with scoped selectors (#id, .class)", () => {
    const program1 = parse("UPDATE #app SET text = 'Hello'");
    expect(program1.statements[0]!.type).toBe("update");

    const program2 = parse("UPDATE .counter SET text = CAST(text AS INT) + 1");
    expect(program2.statements[0]!.type).toBe("update");
  });

  it("parses INSERT INTO", () => {
    const program = parse(
      "INSERT INTO #todoList (tag, class, text) VALUES ('li', 'todo-item', 'Buy milk')"
    );
    const stmt = program.statements[0]!;
    expect(stmt.type).toBe("insert");
  });

  it("parses DELETE FROM", () => {
    const program = parse(
      "DELETE FROM Elements WHERE class LIKE '%expired%'"
    );
    const stmt = program.statements[0]!;
    expect(stmt.type).toBe("delete");
  });

  it("parses IS NULL / IS NOT NULL with full expression span", () => {
    const program = parse("SELECT * FROM Elements WHERE text IS NULL");
    const stmt = program.statements[0]!;
    if (stmt.type === "select" && stmt.where) {
      expect(stmt.where.type).toBe("is_null_expr");
      expect(stmt.where.span.start.column).toBe(30); // starts at 'text'
    }

    const program2 = parse("SELECT * FROM Elements WHERE text IS NOT NULL");
    const stmt2 = program2.statements[0]!;
    if (stmt2.type === "select" && stmt2.where) {
      expect(stmt2.where.type).toBe("is_null_expr");
      if (stmt2.where.type === "is_null_expr") {
        expect(stmt2.where.not).toBe(true);
      }
    }
  });

  it("parses NOT LIKE expression", () => {
    const program = parse("SELECT * FROM Elements WHERE class NOT LIKE '%error%'");
    const stmt = program.statements[0]!;
    if (stmt.type === "select" && stmt.where) {
      expect(stmt.where.type).toBe("unary_expr");
      if (stmt.where.type === "unary_expr") {
        expect(stmt.where.operator).toBe("NOT");
        expect(stmt.where.operand.type).toBe("binary_expr");
      }
    }
  });

  it("parses function calls including COUNT(*)", () => {
    const program = parse("SELECT LEN(text), COUNT(*) FROM Elements");
    const stmt = program.statements[0]!;
    if (stmt.type === "select") {
      expect(stmt.columns).toHaveLength(2);
      expect(stmt.columns[0]!.type === "column" && stmt.columns[0]!.expr.type).toBe("function_call");
      expect(stmt.columns[1]!.type === "column" && stmt.columns[1]!.expr.type).toBe("function_call");
    }
  });

  it("parses CAST", () => {
    const program = parse("SELECT CAST(value AS INT) FROM Elements");
    const stmt = program.statements[0]!;
    if (stmt.type === "select" && stmt.columns[0]!.type === "column") {
      expect(stmt.columns[0]!.expr.type).toBe("cast_expr");
    }
  });

  it("parses property paths and assignment spans", () => {
    const program = parse(
      "UPDATE Elements SET style.color = 'red' WHERE class LIKE '%error%'"
    );
    const stmt = program.statements[0]!;
    if (stmt.type === "update") {
      expect(stmt.assignments[0]!.target.segments.length).toBe(2);
      expect(stmt.assignments[0]!.target.segments[0]!.name).toBe("style");
      expect(stmt.assignments[0]!.target.segments[1]!.name).toBe("color");
      // Assignment span should cover target to value
      expect(stmt.assignments[0]!.span.start.column).toBe(21);
      expect(stmt.assignments[0]!.span.end.column).toBe(40);
    }
  });

  it("parses qualified table names (e.g. CSS.Rules)", () => {
    const program = parse("SELECT * FROM CSS.Rules WHERE selector = '.error'");
    const stmt = program.statements[0]!;
    if (stmt.type === "select" && stmt.source.type === "global") {
      expect(stmt.source.table).toBe("CSS.Rules");
    }
  });

  it("parses BEGIN TRANSACTION / COMMIT / ROLLBACK (and COMMIT/ROLLBACK TRANSACTION)", () => {
    const program = parse("BEGIN TRANSACTION");
    expect(program.statements[0]!.type).toBe("begin_transaction");

    const program2 = parse("COMMIT TRANSACTION");
    expect(program2.statements[0]!.type).toBe("commit");

    const program3 = parse("ROLLBACK TRANSACTION");
    expect(program3.statements[0]!.type).toBe("rollback");
  });

  it("parses multiple statements", () => {
    const program = parse("SELECT * FROM Elements; UPDATE #app SET text = 'hi'");
    expect(program.statements).toHaveLength(2);
    expect(program.statements[0]!.type).toBe("select");
    expect(program.statements[1]!.type).toBe("update");
  });

  it("parses CREATE TRIGGER for CLICK events and AFTER UPDATE OF", () => {
    const program = parse(
      "CREATE TRIGGER inc ON #increment AFTER CLICK AS BEGIN UPDATE #counter SET text = CAST(text AS INT) + 1 END"
    );
    const stmt = program.statements[0]!;
    expect(stmt.type).toBe("create_trigger");
    if (stmt.type === "create_trigger") {
      expect(stmt.name).toBe("inc");
      expect(stmt.target.kind).toBe("id");
      expect(stmt.target.value).toBe("increment");
      expect(stmt.event.type).toBe("event");
    }

    const program2 = parse(
      "CREATE TRIGGER validate_username ON #username AFTER UPDATE OF value AS BEGIN UPDATE #status SET text = 'ok' END"
    );
    const stmt2 = program2.statements[0]!;
    expect(stmt2.type).toBe("create_trigger");
    if (stmt2.type === "create_trigger") {
      expect(stmt2.updateColumn).toBe("value");
    }
  });

  it("reports parse errors as structured diagnostics", () => {
    expect(() => parse("SELEC * FROM Elements")).toThrow(ParseError);
  });
});

describe("Round-trip: parse -> format", () => {
  function roundTrip(sql: string) {
    const lexer = new Lexer(sql);
    const parser = new Parser(lexer.tokenize());
    const program = parser.parse();
    return formatProgram(program);
  }

  it("round-trips SELECT", () => {
    const result = roundTrip("SELECT id, tag, text FROM Elements WHERE tag = 'button'");
    expect(result).toContain("SELECT");
    expect(result).toContain("FROM Elements");
    expect(result).toContain("WHERE");
  });

  it("round-trips UPDATE without extraneous FROM", () => {
    const result = roundTrip(
      "UPDATE Elements SET text = 'Hello' WHERE id = 'message'"
    );
    expect(result).toContain("UPDATE Elements SET");
    expect(result).not.toContain("UPDATE FROM Elements");
    expect(result).toContain("text = 'Hello'");
  });

  it("round-trips strings with single quotes", () => {
    const result = roundTrip(
      "UPDATE Elements SET text = 'it''s ok' WHERE id = 'message'"
    );
    expect(result).toContain("text = 'it''s ok'");
  });
});
