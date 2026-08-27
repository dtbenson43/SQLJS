// Lexer - tokenizes SQL source into a stream of tokens.
// Case-insensitive keywords, single-quoted strings, numbers, identifiers.

import { Token, TokenKind, token, KEYWORDS } from "./tokens";

export class Lexer {
  private source: string;
  private pos: number;
  private line: number;
  private column: number;
  private tokens: Token[];

  constructor(source: string) {
    this.source = source;
    this.pos = 0;
    this.line = 1;
    this.column = 1;
    this.tokens = [];
  }

  /** Tokenize the entire source and return all tokens (including EOF). */
  tokenize(): Token[] {
    this.tokens = [];
    this.pos = 0;
    this.line = 1;
    this.column = 1;

    while (!this.isAtEnd()) {
      this.skipWhitespaceAndComments();
      if (this.isAtEnd()) break;
      this.scanToken();
    }

    this.tokens.push(
      token(TokenKind.EOF, "", this.line, this.column, this.pos)
    );

    return this.tokens;
  }

  // -- Core scanning -------------------------------------------

  private scanToken(): void {
    const c = this.advance();

    switch (c) {
      case "(": this.addSimpleToken(TokenKind.LPAREN); break;
      case ")": this.addSimpleToken(TokenKind.RPAREN); break;
      case ",": this.addSimpleToken(TokenKind.COMMA); break;
      case ";": this.addSimpleToken(TokenKind.SEMICOLON); break;
      case "*": this.addSimpleToken(TokenKind.STAR); break;
      case "+": this.addSimpleToken(TokenKind.PLUS); break;
      case "-": this.addSimpleToken(TokenKind.MINUS); break;
      case "/": this.addSimpleToken(TokenKind.SLASH); break;
      case ".": this.addSimpleToken(TokenKind.DOT); break;
      case "#": this.addSimpleToken(TokenKind.HASH); break;

      case "!":
        if (this.match("=")) {
          this.addCompoundToken(TokenKind.NEQ, "!=");
        } else {
          this.addSimpleToken(TokenKind.UNKNOWN);
        }
        break;
      case "<":
        if (this.match("=")) {
          this.addCompoundToken(TokenKind.LTE, "<=");
        } else if (this.match(">")) {
          this.addCompoundToken(TokenKind.LTGT, "<>");
        } else {
          this.addSimpleToken(TokenKind.LT);
        }
        break;
      case ">":
        if (this.match("=")) {
          this.addCompoundToken(TokenKind.GTE, ">=");
        } else {
          this.addSimpleToken(TokenKind.GT);
        }
        break;
      case "=":
        this.addSimpleToken(TokenKind.EQ);
        break;

      case "'":
        this.scanString();
        break;

      default:
        if (this.isDigit(c)) {
          this.scanNumber();
        }
        else if (this.isIdentifierStart(c)) {
          this.scanIdentifier();
        }
        else {
          this.addSimpleToken(TokenKind.UNKNOWN);
        }
        break;
    }
  }

  // -- String scanning -----------------------------------------

  private scanString(): void {
    const startLine = this.line;
    const startColumn = this.column - 1;
    const startOffset = this.pos - 1;
    let value = "";
    let closed = false;

    while (!this.isAtEnd()) {
      const c = this.peek();

      // Closing quote
      if (c === "'") {
        // Check for escaped quote (two single quotes)
        if (this.peekNext() === "'") {
          this.advance(); // first '
          this.advance(); // second '
          value += "'";
          continue;
        }
        // Single quote - end of string
        this.advance(); // consume closing quote
        closed = true;
        break;
      }

      value += this.advance();
    }

    const rawLexeme = this.source.slice(startOffset, this.pos);

    if (!closed) {
      // We never found a closing quote
      this.tokens.push(
        token(TokenKind.UNKNOWN, rawLexeme, startLine, startColumn, startOffset)
      );
      return;
    }

    this.tokens.push(
      token(TokenKind.STRING, rawLexeme, startLine, startColumn, startOffset, value)
    );
  }

  // -- Number scanning -----------------------------------------

  private scanNumber(): void {
    const startLine = this.line;
    const startColumn = this.column - 1;
    const startOffset = this.pos - 1;

    while (this.isDigit(this.peek())) {
      this.advance();
    }

    if (this.peek() === "." && this.isDigit(this.peekNext())) {
      this.advance();
      while (this.isDigit(this.peek())) {
        this.advance();
      }
    }

    const lexeme = this.source.slice(startOffset, this.pos);

    this.tokens.push(
      token(TokenKind.NUMBER, lexeme, startLine, startColumn, startOffset, parseFloat(lexeme))
    );
  }

  // -- Identifier / keyword scanning ---------------------------

  private scanIdentifier(): void {
    const startLine = this.line;
    const startColumn = this.column - 1;
    const startOffset = this.pos - 1;

    while (this.isIdentifierPart(this.peek())) {
      this.advance();
    }

    const lexeme = this.source.slice(startOffset, this.pos);
    const upper = lexeme.toUpperCase();
    const kind = KEYWORDS[upper] ?? TokenKind.IDENTIFIER;

    const value =
      kind === TokenKind.TRUE ? true
      : kind === TokenKind.FALSE ? false
      : kind === TokenKind.NULL ? null
      : undefined;

    this.tokens.push(
      token(kind, lexeme, startLine, startColumn, startOffset, value)
    );
  }

  // -- Whitespace and comments ---------------------------------

  private skipWhitespaceAndComments(): void {
    while (!this.isAtEnd()) {
      const c = this.peek();

      if (c === " " || c === "\t" || c === "\r" || c === "\n") {
        this.advance();
        continue;
      }

      if (c === "-" && this.peekNext() === "-") {
        this.advance();
        this.advance();
        while (!this.isAtEnd() && this.peek() !== "\n") {
          this.advance();
        }
        continue;
      }

      if (c === "/" && this.peekNext() === "*") {
        this.advance();
        this.advance();
        while (!this.isAtEnd()) {
          if (this.peek() === "*" && this.peekNext() === "/") {
            this.advance();
            this.advance();
            break;
          }
          this.advance();
        }
        continue;
      }

      break;
    }
  }

  // -- Character predicates ------------------------------------

  private isDigit(c: string): boolean {
    return c >= "0" && c <= "9";
  }

  private isIdentifierStart(c: string): boolean {
    return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$";
  }

  private isIdentifierPart(c: string): boolean {
    return this.isIdentifierStart(c) || this.isDigit(c) || c === "-";
  }

  // -- Source navigation ---------------------------------------

  private advance(): string {
    const c = this.source[this.pos]!;
    this.pos++;
    if (c === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return c;
  }

  private peek(): string {
    // Return empty string for end-of-input (not null byte)
    return this.pos < this.source.length ? this.source[this.pos]! : "";
  }

  private peekNext(): string {
    return this.pos + 1 < this.source.length ? this.source[this.pos + 1]! : "";
  }

  private match(expected: string): boolean {
    if (this.peek() === expected) {
      this.advance();
      return true;
    }
    return false;
  }

  private isAtEnd(): boolean {
    return this.pos >= this.source.length;
  }

  // -- Token emission helpers ----------------------------------

  private addSimpleToken(kind: TokenKind): void {
    const lexeme = this.source[this.pos - 1]!;
    this.tokens.push(
      token(kind, lexeme, this.line, this.column - 1, this.pos - 1)
    );
  }

  private addCompoundToken(kind: TokenKind, lexeme: string): void {
    this.tokens.push(
      token(kind, lexeme, this.line, this.column - lexeme.length, this.pos - lexeme.length)
    );
  }
}
