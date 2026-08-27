// Token types for the lexer.
// The lexer produces these tokens; the parser consumes them.

export enum TokenKind {
  // Keywords
  SELECT = "SELECT",
  FROM = "FROM",
  WHERE = "WHERE",
  INSERT = "INSERT",
  INTO = "INTO",
  VALUES = "VALUES",
  UPDATE = "UPDATE",
  SET = "SET",
  DELETE = "DELETE",
  CREATE = "CREATE",
  TRIGGER = "TRIGGER",
  ON = "ON",
  AFTER = "AFTER",
  OF = "OF",
  AS = "AS",
  BEGIN = "BEGIN",
  TRANSACTION = "TRANSACTION",
  COMMIT = "COMMIT",
  ROLLBACK = "ROLLBACK",
  END = "END",
  RETURNING = "RETURNING",
  AND = "AND",
  OR = "OR",
  NOT = "NOT",
  LIKE = "LIKE",
  IS = "IS",
  NULL = "NULL",
  TRUE = "TRUE",
  FALSE = "FALSE",
  CAST = "CAST",
  CASE = "CASE",
  WHEN = "WHEN",
  THEN = "THEN",
  ELSE = "ELSE",
  OLD = "OLD",
  NEW = "NEW",

  // Punctuation
  DOT = "DOT",
  COMMA = "COMMA",
  SEMICOLON = "SEMICOLON",
  LPAREN = "LPAREN",
  RPAREN = "RPAREN",
  STAR = "STAR",
  PLUS = "PLUS",
  MINUS = "MINUS",
  SLASH = "SLASH",
  HASH = "HASH",

  // Comparison
  EQ = "EQ",
  NEQ = "NEQ",       // !=
  LT = "LT",
  GT = "GT",
  LTE = "LTE",
  GTE = "GTE",
  LTGT = "LTGT",     // <> (alternative not-equal)

  // Values
  IDENTIFIER = "IDENTIFIER",
  STRING = "STRING",
  NUMBER = "NUMBER",

  // Special
  EOF = "EOF",
  UNKNOWN = "UNKNOWN",
}

export interface Token {
  kind: TokenKind;
  lexeme: string;       // the raw matched text
  line: number;         // 1-based
  column: number;       // 1-based
  offset: number;       // 0-based character offset
  length: number;       // length in characters

  // Value for literals
  value?: string | number | boolean | null;
}

// Token creation helper
export function token(
  kind: TokenKind,
  lexeme: string,
  line: number,
  column: number,
  offset: number,
  value?: string | number | boolean | null
): Token {
  return {
    kind,
    lexeme,
    line,
    column,
    offset,
    length: lexeme.length,
    value,
  };
}

// Map of keyword strings to their token kinds
export const KEYWORDS: Record<string, TokenKind> = {
  SELECT: TokenKind.SELECT,
  FROM: TokenKind.FROM,
  WHERE: TokenKind.WHERE,
  INSERT: TokenKind.INSERT,
  INTO: TokenKind.INTO,
  VALUES: TokenKind.VALUES,
  UPDATE: TokenKind.UPDATE,
  SET: TokenKind.SET,
  DELETE: TokenKind.DELETE,
  CREATE: TokenKind.CREATE,
  TRIGGER: TokenKind.TRIGGER,
  ON: TokenKind.ON,
  AFTER: TokenKind.AFTER,
  OF: TokenKind.OF,
  AS: TokenKind.AS,
  BEGIN: TokenKind.BEGIN,
  TRANSACTION: TokenKind.TRANSACTION,
  COMMIT: TokenKind.COMMIT,
  ROLLBACK: TokenKind.ROLLBACK,
  END: TokenKind.END,
  RETURNING: TokenKind.RETURNING,
  AND: TokenKind.AND,
  OR: TokenKind.OR,
  NOT: TokenKind.NOT,
  LIKE: TokenKind.LIKE,
  IS: TokenKind.IS,
  NULL: TokenKind.NULL,
  TRUE: TokenKind.TRUE,
  FALSE: TokenKind.FALSE,
  CAST: TokenKind.CAST,
  CASE: TokenKind.CASE,
  WHEN: TokenKind.WHEN,
  THEN: TokenKind.THEN,
  ELSE: TokenKind.ELSE,
  OLD: TokenKind.OLD,
  NEW: TokenKind.NEW,
};
