import { Lexer } from "../language/lexer";
import { ParseError } from "../language/errors";
import { Parser } from "../language/parser";
import { Program } from "../language/ast";
import { compileProgramObject } from "./statements";

export interface CompileOptions {
  runtimeName?: string;
}

/**
 * Parse SQL and compile it into a callable JavaScript function expression.
 * The generated function expects (runtime, root, params) where runtime is the
 * SQL boundary (statement executor plus expression helpers).
 */
export function compile(source: string, options: CompileOptions = {}): string {
  const lexer = new Lexer(source);
  const parser = new Parser(lexer.tokenize());
  return compileProgram(parser.parse(), options);
}

/**
 * Compile an existing AST without parsing SQL again.
 * Expressions become closures; statement structure stays as plain data consumed
 * by runtime.executeProgram, preserving the shared AST contract.
 */
export function compileProgram(program: Program, options: CompileOptions = {}): string {
  const runtimeName = options.runtimeName ?? "runtime";
  const programObject = compileProgramObject(program);
  if (!programObject) throw new Error("Unable to compile program AST");
  return "( " + runtimeName + ", root, params = {} ) => " + runtimeName + ".executeProgram(" + programObject + ", { root, params })";
}

/** Compile SQL and return diagnostics instead of throwing on parse errors. */
export function tryCompile(source: string, options: CompileOptions = {}):
  { code?: string; diagnostics: string[] } {
  try {
    return { code: compile(source, options), diagnostics: [] };
  } catch (error) {
    if (error instanceof ParseError) {
      return { diagnostics: error.diagnostics.map((diagnostic) => diagnostic.message) };
    }
    throw error;
  }
}
