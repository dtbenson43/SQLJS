// Parser - recursive-descent parser for the SQL-DOM language.
// Consumes tokens from the Lexer and produces an AST.

import { Token, TokenKind } from "./tokens";
import {
  Program, Statement, Expression,
  SelectStatement, UpdateStatement, InsertStatement, DeleteStatement,
  BeginTransaction, CommitStatement, RollbackStatement,
  CreateTriggerStatement,
  SelectColumn, QuerySource, Assignment,
  Identifier, PropertyPath, ElementSelector,
  BinaryExpr, UnaryExpr, IsNullExpr,
  FunctionCall, CastExpr, OldNewRef,
  SourceSpan,
  TriggerEvent,
} from "./ast";
import { Diagnostic, ParseError } from "./errors";

export class Parser {
  private tokens: Token[];
  private pos: number;
  private diagnostics: Diagnostic[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
    this.diagnostics = [];
  }

  /** Parse a complete program (multiple statements separated by ;). */
  parse(): Program {
    this.pos = 0;
    this.diagnostics = [];

    const statements: Statement[] = [];

    while (!this.isAtEnd()) {
      if (this.check(TokenKind.SEMICOLON)) {
        this.advance();
        continue;
      }

      try {
        const stmt = this.parseStatement();
        if (stmt) statements.push(stmt);
      } catch (e) {
        if (e instanceof ParseError) {
          this.diagnostics.push(...e.diagnostics);
          this.synchronize();
        } else {
          throw e;
        }
      }
    }

    if (this.diagnostics.length > 0) {
      throw new ParseError(this.diagnostics);
    }

    const start = this.tokens[0]!;
    const end = this.tokens[this.tokens.length - 1]!;
    return {
      type: "program",
      span: this.spanFromTokens(start, end),
      statements,
    };
  }

  // -- Statement parsing ---------------------------------------

  private parseStatement(): Statement {
    const kind = this.current()!.kind;

    switch (kind) {
      case TokenKind.SELECT: return this.parseSelect();
      case TokenKind.INSERT: return this.parseInsert();
      case TokenKind.UPDATE: return this.parseUpdate();
      case TokenKind.DELETE: return this.parseDelete();
      case TokenKind.BEGIN: return this.parseBegin();
      case TokenKind.COMMIT: return this.parseCommit();
      case TokenKind.ROLLBACK: return this.parseRollback();
      case TokenKind.CREATE: return this.parseCreateTrigger();
      default:
        throw this.errorAt(
          this.current()!,
          "Expected a statement (SELECT, INSERT, UPDATE, DELETE, BEGIN, COMMIT, ROLLBACK, CREATE)"
        );
    }
  }

  // -- SELECT --------------------------------------------------

  private parseSelect(): SelectStatement {
    const start = this.advance();

    const columns: SelectColumn[] = [];
    do {
      if (this.check(TokenKind.STAR)) {
        const star = this.advance();
        columns.push({ type: "star", span: this.span(star) });
      } else {
        const expr = this.parseExpression();
        let alias: string | undefined;
        let endSpan = expr.span;
        if (this.check(TokenKind.AS)) {
          this.advance();
          const aliasToken = this.consume(TokenKind.IDENTIFIER, "Expected alias name");
          alias = aliasToken.lexeme;
          endSpan = this.span(aliasToken);
        } else if (this.check(TokenKind.IDENTIFIER)) {
          const aliasToken = this.advance();
          alias = aliasToken.lexeme;
          endSpan = this.span(aliasToken);
        }
        columns.push({
          type: "column",
          expr,
          alias,
          span: { start: expr.span.start, end: endSpan.end },
        });
      }

      if (this.check(TokenKind.COMMA)) {
        this.advance();
      } else {
        break;
      }
    } while (true);

    this.consume(TokenKind.FROM, "Expected FROM");
    const source = this.parseQuerySource();

    let where: Expression | undefined;
    if (this.check(TokenKind.WHERE)) {
      this.advance();
      where = this.parseExpression();
    }

    return {
      type: "select",
      span: this.spanFromTokens(start, this.previous()!),
      columns,
      source,
      where,
    };
  }

  // -- UPDATE --------------------------------------------------

  private parseUpdate(): UpdateStatement {
    const start = this.advance();

    // In standard SQL, UPDATE is followed directly by the table/source.
    // Allow optional FROM for compatibility.
    if (this.check(TokenKind.FROM)) {
      this.advance();
    }
    const source = this.parseQuerySource();

    this.consume(TokenKind.SET, "Expected SET");

    const assignments: Assignment[] = [];
    do {
      const target = this.parsePropertyPath();
      this.consume(TokenKind.EQ, "Expected =");
      const value = this.parseExpression();
      assignments.push({
        type: "assignment",
        span: this.spanFromNodes(target, value),
        target,
        value,
      });

      if (this.check(TokenKind.COMMA)) {
        this.advance();
      } else {
        break;
      }
    } while (true);

    let where: Expression | undefined;
    if (this.check(TokenKind.WHERE)) {
      this.advance();
      where = this.parseExpression();
    }

    return {
      type: "update",
      span: this.spanFromTokens(start, this.previous()!),
      source,
      assignments,
      where,
    };
  }

  // -- INSERT --------------------------------------------------

  private parseInsert(): InsertStatement {
    const start = this.advance();

    this.consume(TokenKind.INTO, "Expected INTO");
    const source = this.parseQuerySource();

    const columns: Identifier[] = [];
    if (this.check(TokenKind.LPAREN)) {
      this.advance();
      do {
        const id = this.consume(TokenKind.IDENTIFIER, "Expected column name");
        columns.push({
          type: "identifier",
          span: this.span(id),
          name: id.lexeme,
        });
        if (this.check(TokenKind.COMMA)) {
          this.advance();
        } else {
          break;
        }
      } while (true);
      this.consume(TokenKind.RPAREN, "Expected )");
    }

    this.consume(TokenKind.VALUES, "Expected VALUES");

    const values: Expression[][] = [];
    do {
      this.consume(TokenKind.LPAREN, "Expected (");
      const row: Expression[] = [];
      do {
        row.push(this.parseExpression());
        if (this.check(TokenKind.COMMA)) {
          this.advance();
        } else {
          break;
        }
      } while (true);
      this.consume(TokenKind.RPAREN, "Expected )");
      values.push(row);

      if (this.check(TokenKind.COMMA)) {
        this.advance();
      } else {
        break;
      }
    } while (true);

    let returning: Identifier[] | undefined;
    if (this.check(TokenKind.RETURNING)) {
      this.advance();
      returning = [];
      do {
        const id = this.consume(TokenKind.IDENTIFIER, "Expected column name after RETURNING");
        returning.push({
          type: "identifier",
          span: this.span(id),
          name: id.lexeme,
        });
        if (this.check(TokenKind.COMMA)) {
          this.advance();
        } else {
          break;
        }
      } while (true);
    }

    return {
      type: "insert",
      span: this.spanFromTokens(start, this.previous()!),
      source,
      columns,
      values,
      returning,
    };
  }

  // -- DELETE --------------------------------------------------

  private parseDelete(): DeleteStatement {
    const start = this.advance();

    if (this.check(TokenKind.FROM)) {
      this.advance();
    }
    const source = this.parseQuerySource();

    let where: Expression | undefined;
    if (this.check(TokenKind.WHERE)) {
      this.advance();
      where = this.parseExpression();
    }

    return {
      type: "delete",
      span: this.spanFromTokens(start, this.previous()!),
      source,
      where,
    };
  }

  // -- Transactions --------------------------------------------

  private parseBegin(): BeginTransaction {
    const start = this.advance();
    this.consume(TokenKind.TRANSACTION, "Expected TRANSACTION after BEGIN");
    return {
      type: "begin_transaction",
      span: this.spanFromTokens(start, this.previous()!),
    };
  }

  private parseCommit(): CommitStatement {
    const start = this.advance();
    let endToken = start;
    if (this.check(TokenKind.TRANSACTION)) {
      endToken = this.advance();
    }
    return {
      type: "commit",
      span: this.spanFromTokens(start, endToken),
    };
  }

  private parseRollback(): RollbackStatement {
    const start = this.advance();
    let endToken = start;
    if (this.check(TokenKind.TRANSACTION)) {
      endToken = this.advance();
    }
    return {
      type: "rollback",
      span: this.spanFromTokens(start, endToken),
    };
  }

  // -- CREATE TRIGGER ------------------------------------------

  private parseCreateTrigger(): CreateTriggerStatement {
    const start = this.advance();
    this.consume(TokenKind.TRIGGER, "Expected TRIGGER");

    const name = this.consume(TokenKind.IDENTIFIER, "Expected trigger name").lexeme;
    this.consume(TokenKind.ON, "Expected ON");

    const target = this.parseElementSelector();
    this.consume(TokenKind.AFTER, "Expected AFTER");

    const eventToken = this.advance();
    const eventName = eventToken.lexeme.toUpperCase();

    let event: TriggerEvent;
    let updateColumn: string | undefined;
    if (eventName === "UPDATE") {
      if (this.check(TokenKind.OF)) {
        this.advance();
        updateColumn = this.consume(TokenKind.IDENTIFIER, "Expected column name after OF").lexeme;
      }
      event = { type: "mutation", name: "UPDATE" };
    } else if (
      ["CLICK", "CHANGE", "INPUT", "SUBMIT", "FOCUS", "BLUR", "KEYDOWN", "KEYUP"].includes(eventName)
    ) {
      event = { type: "event", name: eventName as "CLICK" | "CHANGE" | "INPUT" | "SUBMIT" | "FOCUS" | "BLUR" | "KEYDOWN" | "KEYUP" };
    } else {
      throw this.errorAt(eventToken, "Expected event type (CLICK, CHANGE, INPUT, SUBMIT, FOCUS, BLUR, KEYDOWN, KEYUP, UPDATE)");
    }

    this.consume(TokenKind.AS, "Expected AS");
    this.consume(TokenKind.BEGIN, "Expected BEGIN");
    const body = this.parseStatementList();
    this.consume(TokenKind.END, "Expected END");

    return {
      type: "create_trigger",
      span: this.spanFromTokens(start, this.previous()!),
      name,
      target,
      event,
      updateColumn,
      body,
    };
  }

  // -- Query source parsing ------------------------------------

  private parseQuerySource(): QuerySource {
    if (this.check(TokenKind.IDENTIFIER)) {
      const id = this.advance();
      const upper = id.lexeme.toUpperCase();

      if (upper === "CHILDREN" || upper === "DESCENDANTS") {
        this.consume(TokenKind.LPAREN, "Expected (");
        const selector = this.parseElementSelector();
        this.consume(TokenKind.RPAREN, "Expected )");
        return {
          type: upper === "CHILDREN" ? "children" : "descendants",
          selector,
          span: this.spanFromTokens(id, this.previous()!),
        };
      }

      if (upper === "PARENT") {
        this.consume(TokenKind.OF, "Expected OF");
        const selector = this.parseElementSelector();
        return {
          type: "parent",
          selector,
          span: this.spanFromTokens(id, this.previous()!),
        };
      }

      if (this.check(TokenKind.DOT)) {
        this.advance();
        const sub = this.consume(TokenKind.IDENTIFIER, "Expected table name after .");
        return {
          type: "global",
          table: `${id.lexeme}.${sub.lexeme}`,
          span: this.spanFromTokens(id, sub),
        };
      }

      return {
        type: "global",
        table: id.lexeme,
        span: this.span(id),
      };
    }

    if (this.check(TokenKind.HASH) || this.check(TokenKind.DOT)) {
      const selector = this.parseElementSelector();
      return {
        type: "scoped",
        selector,
        span: selector.span,
      };
    }

    throw this.errorAt(this.current()!, "Expected table name, #id, or .class after FROM");
  }

  // -- Element selector ----------------------------------------

  private parseElementSelector(): ElementSelector {
    if (this.check(TokenKind.HASH)) {
      const hashToken = this.advance();
      const id = this.consume(TokenKind.IDENTIFIER, "Expected element ID after #");
      return {
        type: "element_selector",
        span: this.spanFromTokens(hashToken, id),
        kind: "id",
        value: id.lexeme,
      };
    }

    if (this.check(TokenKind.DOT)) {
      const dotToken = this.advance();
      const cls = this.consume(TokenKind.IDENTIFIER, "Expected class name after .");
      return {
        type: "element_selector",
        span: this.spanFromTokens(dotToken, cls),
        kind: "class",
        value: cls.lexeme,
      };
    }

    const id = this.consume(TokenKind.IDENTIFIER, "Expected element selector");
    return {
      type: "element_selector",
      span: this.span(id),
      kind: "name",
      value: id.lexeme,
    };
  }

  // -- Expression parsing (precedence climbing) -----------------

  private parseExpression(): Expression {
    return this.parseOr();
  }

  private parseOr(): Expression {
    let left = this.parseAnd();

    while (this.check(TokenKind.OR)) {
      const op = this.advance();
      const right = this.parseAnd();
      left = {
        type: "binary_expr",
        span: this.spanFromNodes(left, right),
        operator: "OR",
        left,
        right,
      };
    }

    return left;
  }

  private parseAnd(): Expression {
    let left = this.parseNot();

    while (this.check(TokenKind.AND)) {
      const op = this.advance();
      const right = this.parseNot();
      left = {
        type: "binary_expr",
        span: this.spanFromNodes(left, right),
        operator: "AND",
        left,
        right,
      };
    }

    return left;
  }

  private parseNot(): Expression {
    if (this.check(TokenKind.NOT)) {
      const op = this.advance();
      const operand = this.parseComparison();
      return {
        type: "unary_expr",
        span: this.spanFromTokens(op, this.previous()!),
        operator: "NOT",
        operand,
      };
    }

    return this.parseComparison();
  }

  private parseComparison(): Expression {
    let left = this.parseAddition();

    while (
      this.check(TokenKind.EQ) ||
      this.check(TokenKind.NEQ) ||
      this.check(TokenKind.LTGT) ||
      this.check(TokenKind.LT) ||
      this.check(TokenKind.GT) ||
      this.check(TokenKind.LTE) ||
      this.check(TokenKind.GTE) ||
      this.check(TokenKind.LIKE) ||
      this.check(TokenKind.IS) ||
      (this.check(TokenKind.NOT) && this.peek().kind === TokenKind.LIKE)
    ) {
      if (this.check(TokenKind.IS)) {
        const op = this.advance();
        const not = this.check(TokenKind.NOT);
        if (not) this.advance();
        const nullToken = this.consume(TokenKind.NULL, "Expected NULL after IS");
        left = {
          type: "is_null_expr",
          span: this.spanFromNodes(left, { span: this.span(nullToken) }),
          operand: left,
          not,
        };
        continue;
      }

      if (this.check(TokenKind.NOT) && this.peek().kind === TokenKind.LIKE) {
        const notToken = this.advance();
        const likeToken = this.advance();
        const right = this.parseAddition();
        const likeExpr: BinaryExpr = {
          type: "binary_expr",
          span: this.spanFromNodes(left, right),
          operator: "LIKE",
          left,
          right,
        };
        left = {
          type: "unary_expr",
          span: this.spanFromNodes(left, right),
          operator: "NOT",
          operand: likeExpr,
        };
        continue;
      }

      const op = this.advance();
      const operator = op.kind === TokenKind.LTGT ? "<>" : op.lexeme as BinaryExpr["operator"];
      const right = this.parseAddition();
      left = {
        type: "binary_expr",
        span: this.spanFromNodes(left, right),
        operator: operator,
        left,
        right,
      };
    }

    return left;
  }

  private parseAddition(): Expression {
    let left = this.parseMultiplication();

    while (this.check(TokenKind.PLUS) || this.check(TokenKind.MINUS)) {
      const op = this.advance();
      const right = this.parseMultiplication();
      left = {
        type: "binary_expr",
        span: this.spanFromNodes(left, right),
        operator: op.kind === TokenKind.PLUS ? "+" : "-",
        left,
        right,
      };
    }

    return left;
  }

  private parseMultiplication(): Expression {
    let left = this.parseUnary();

    while (this.check(TokenKind.STAR) || this.check(TokenKind.SLASH)) {
      const op = this.advance();
      const right = this.parseUnary();
      left = {
        type: "binary_expr",
        span: this.spanFromNodes(left, right),
        operator: op.kind === TokenKind.STAR ? "*" : "/",
        left,
        right,
      };
    }

    return left;
  }

  private parseUnary(): Expression {
    if (this.check(TokenKind.MINUS)) {
      const op = this.advance();
      const operand = this.parsePrimary();
      return {
        type: "unary_expr",
        span: this.spanFromTokens(op, this.previous()!),
        operator: "-",
        operand,
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expression {
    const token = this.current()!;

    if (token.kind === TokenKind.STRING) {
      this.advance();
      return {
        type: "literal_string",
        span: this.span(token),
        value: token.value as string,
      };
    }

    if (token.kind === TokenKind.NUMBER) {
      this.advance();
      return {
        type: "literal_number",
        span: this.span(token),
        value: token.value as number,
      };
    }

    if (token.kind === TokenKind.TRUE) {
      this.advance();
      return {
        type: "literal_boolean",
        span: this.span(token),
        value: true,
      };
    }

    if (token.kind === TokenKind.FALSE) {
      this.advance();
      return {
        type: "literal_boolean",
        span: this.span(token),
        value: false,
      };
    }

    if (token.kind === TokenKind.NULL) {
      this.advance();
      return {
        type: "literal_null",
        span: this.span(token),
      };
    }

    if (token.kind === TokenKind.OLD || token.kind === TokenKind.NEW) {
      this.advance();
      const kind = (token.kind === TokenKind.OLD ? "old" : "new") as "old" | "new";
      let property: Identifier | undefined;
      if (this.check(TokenKind.DOT)) {
        this.advance();
        const prop = this.consume(TokenKind.IDENTIFIER, "Expected property name after OLD./NEW.");
        property = {
          type: "identifier",
          span: this.span(prop),
          name: prop.lexeme,
        };
      }
      return {
        type: "old_new_ref",
        span: this.spanFromTokens(token, this.previous()!),
        kind,
        property,
      };
    }

    if (token.kind === TokenKind.CAST) {
      this.advance();
      this.consume(TokenKind.LPAREN, "Expected ( after CAST");
      const operand = this.parseExpression();
      this.consume(TokenKind.AS, "Expected AS in CAST");
      const typeToken = this.consume(TokenKind.IDENTIFIER, "Expected type name");
      this.consume(TokenKind.RPAREN, "Expected )");
      return {
        type: "cast_expr",
        span: this.spanFromTokens(token, this.previous()!),
        operand,
        targetType: typeToken.lexeme.toUpperCase(),
      };
    }

    if (token.kind === TokenKind.IDENTIFIER && this.peek().kind === TokenKind.LPAREN) {
      const name = this.advance().lexeme;
      this.advance(); // (
      const args: Expression[] = [];
      if (!this.check(TokenKind.RPAREN)) {
        do {
          if (this.check(TokenKind.STAR)) {
            const star = this.advance();
            args.push({
              type: "column_ref",
              span: this.span(star),
              name: "*",
            });
          } else {
            args.push(this.parseExpression());
          }
          if (this.check(TokenKind.COMMA)) {
            this.advance();
          } else {
            break;
          }
        } while (true);
      }
      this.consume(TokenKind.RPAREN, "Expected )");
      return {
        type: "function_call",
        span: this.spanFromTokens(token, this.previous()!),
        name: name.toUpperCase(),
        args,
      };
    }

    if (token.kind === TokenKind.IDENTIFIER) {
      const first = this.advance();
      if (this.check(TokenKind.DOT)) {
        const segments: Identifier[] = [
          { type: "identifier", span: this.span(first), name: first.lexeme },
        ];
        while (this.check(TokenKind.DOT)) {
          this.advance();
          const seg = this.consume(TokenKind.IDENTIFIER, "Expected property name after .");
          segments.push({
            type: "identifier",
            span: this.span(seg),
            name: seg.lexeme,
          });
        }
        return {
          type: "property_path",
          span: this.spanFromTokens(first, this.previous()!),
          segments,
        };
      }
      return {
        type: "column_ref",
        span: this.span(first),
        name: first.lexeme,
      };
    }

    if (token.kind === TokenKind.LPAREN) {
      this.advance();
      const expr = this.parseExpression();
      this.consume(TokenKind.RPAREN, "Expected )");
      return expr;
    }

    if (token.kind === TokenKind.HASH) {
      const selector = this.parseElementSelector();
      return {
        type: "literal_string",
        span: selector.span,
        value: selector.value,
      };
    }

    throw this.errorAt(token, "Expected expression");
  }

  // -- Property path parsing -----------------------------------

  private parsePropertyPath(): PropertyPath {
    const first = this.consume(TokenKind.IDENTIFIER, "Expected property name");
    const segments: Identifier[] = [
      { type: "identifier", span: this.span(first), name: first.lexeme },
    ];

    while (this.check(TokenKind.DOT)) {
      this.advance();
      const seg = this.consume(TokenKind.IDENTIFIER, "Expected property name after .");
      segments.push({
        type: "identifier",
        span: this.span(seg),
        name: seg.lexeme,
      });
    }

    return {
      type: "property_path",
      span: this.spanFromTokens(first, this.previous()!),
      segments,
    };
  }

  // -- Statement list ------------------------------------------

  private parseStatementList(): Statement[] {
    const statements: Statement[] = [];
    while (
      !this.check(TokenKind.END) &&
      !this.check(TokenKind.EOF) &&
      !this.check(TokenKind.COMMIT) &&
      !this.check(TokenKind.ROLLBACK)
    ) {
      if (this.check(TokenKind.SEMICOLON)) {
        this.advance();
        continue;
      }
      statements.push(this.parseStatement());
      if (this.check(TokenKind.SEMICOLON)) {
        this.advance();
      }
    }
    return statements;
  }

  // -- Helpers -------------------------------------------------

  private current(): Token | undefined {
    return this.tokens[this.pos];
  }

  private peek(): Token {
    return this.tokens[this.pos + 1] ?? this.tokens[this.tokens.length - 1]!;
  }

  private advance(): Token {
    const token = this.tokens[this.pos];
    if (token && token.kind !== TokenKind.EOF) {
      this.pos++;
    }
    return token!;
  }

  private previous(): Token {
    return this.tokens[this.pos - 1]!;
  }

  private check(kind: TokenKind): boolean {
    return this.current()?.kind === kind;
  }

  private consume(kind: TokenKind, message: string): Token {
    if (this.check(kind)) {
      return this.advance();
    }
    const found = this.current()?.lexeme ? this.current()!.lexeme : "EOF";
    throw this.errorAt(this.current()!, message + " but found " + found);
  }

  private isAtEnd(): boolean {
    return this.current()?.kind === TokenKind.EOF || this.pos >= this.tokens.length;
  }

  // -- Error handling ------------------------------------------

  private errorAt(token: Token, message: string): ParseError {
    const diagnostic: Diagnostic = {
      message,
      line: token.line,
      column: token.column,
      length: token.length || 1,
      severity: "error",
    };
    return new ParseError([diagnostic]);
  }

  private synchronize(): void {
    while (!this.isAtEnd()) {
      const kind = this.current()!.kind;
      if (kind === TokenKind.SEMICOLON) {
        this.advance();
        return;
      }
      if (
        kind === TokenKind.SELECT ||
        kind === TokenKind.INSERT ||
        kind === TokenKind.UPDATE ||
        kind === TokenKind.DELETE ||
        kind === TokenKind.CREATE ||
        kind === TokenKind.BEGIN ||
        kind === TokenKind.COMMIT ||
        kind === TokenKind.ROLLBACK
      ) {
        return;
      }
      this.advance();
    }
  }

  // -- Source span helpers -------------------------------------

  private span(token: Token): SourceSpan {
    return {
      start: { line: token.line, column: token.column, offset: token.offset },
      end: {
        line: token.line,
        column: token.column + token.length,
        offset: token.offset + token.length,
      },
    };
  }

  private spanFromTokens(start: Token, end: Token): SourceSpan {
    return {
      start: { line: start.line, column: start.column, offset: start.offset },
      end: {
        line: end.line,
        column: end.column + end.length,
        offset: end.offset + end.length,
      },
    };
  }

  private spanFromNodes(start: { span: SourceSpan }, end: { span: SourceSpan }): SourceSpan {
    return {
      start: start.span.start,
      end: end.span.end,
    };
  }
}
