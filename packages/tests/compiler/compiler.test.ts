import { describe, expect, it } from "vitest";
import { compile, compileProgram, tryCompile } from "../../compiler";
import { Lexer } from "../../language/lexer";
import { Parser } from "../../language/parser";

describe("AST-to-JavaScript compiler", () => {
  it("emits a callable function containing the parsed AST", () => {
    const code = compile("SELECT id FROM Elements WHERE tag = 'button';");
    expect(code).toContain("executeProgram");
    expect(code).toContain("runtime.eq");
    expect(code).toContain("\"button\"");

    const executeProgram = (program: unknown, options: unknown) => ({ program, options });
    const run = Function(`return ${code}`)() as (runtime: unknown, root: unknown, params?: Record<string, unknown>) => unknown;
    const result = run({ executeProgram }, "root", { limit: 2 });

    expect((result as any).program.type).toBe("program");
    expect((result as any).program.statements[0].type).toBe("select");
    expect((result as any).options).toEqual({ root: "root", params: { limit: 2 } });
  });

  it("compiles an existing AST without reparsing SQL", () => {
    const program = new Parser(new Lexer("UPDATE #status SET text = $message;").tokenize()).parse();
    const code = compileProgram(program, { runtimeName: "engine" });
    expect(code).toMatch(/^\( engine, root, params = \{\} \) =>/);
    expect(code).toContain("update");
    expect(code).toContain("ctx.params");
    expect(code).toContain("\"message\"");
  });

  it("returns parse diagnostics through tryCompile", () => {
    const result = tryCompile("SELECT FROM;");
    expect(result.code).toBeUndefined();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
