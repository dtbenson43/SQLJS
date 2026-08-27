// Structured diagnostics for parse errors — feeds directly into Monaco squiggles.

export interface Diagnostic {
  message: string;
  line: number;       // 1-based
  column: number;     // 1-based
  length: number;     // length of the problematic token/region
  severity: "error" | "warning" | "info";
  expectedTokens?: string[];
}

export class ParseError extends Error {
  public readonly diagnostics: Diagnostic[];

  constructor(diagnostics: Diagnostic[]) {
    super(diagnostics.map((d) => d.message).join("; "));
    this.name = "ParseError";
    this.diagnostics = diagnostics;
  }
}

export class SemanticError extends Error {
  public readonly diagnostics: Diagnostic[];

  constructor(diagnostics: Diagnostic[]) {
    super(diagnostics.map((d) => d.message).join("; "));
    this.name = "SemanticError";
    this.diagnostics = diagnostics;
  }
}

export class RuntimeError extends Error {
  public readonly diagnostic: Diagnostic;

  constructor(message: string, diagnostic: Diagnostic) {
    super(message);
    this.name = "RuntimeError";
    this.diagnostic = diagnostic;
  }
}
