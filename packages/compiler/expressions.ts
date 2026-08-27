// Expression compiler: compiles an AST expression to JavaScript source.
// Emitted code is an expression (not a full closure) that closes over ctx
// (the evaluation context) and runtime (the SQL helper boundary).

import { Expression, BinaryExpr, FunctionCall } from "../language/ast";

const ARITHMETIC: Record<string, string> = {
  "+": "add",
  "-": "sub",
  "*": "mul",
  "/": "div",
};

const COMPARISON: Record<string, string> = {
  "=": "eq",
  "!=": "neq",
  "<>": "neq",
  "<": "lt",
  "<=": "lte",
  ">": "gt",
  ">=": "gte",
  LIKE: "like",
};

const SCALAR_FUNCTIONS: Record<string, string> = {
  LEN: "len",
  LOWER: "lower",
  UPPER: "upper",
  COALESCE: "coalesce",
};

const AGGREGATES = new Set(["COUNT", "SUM", "AVG", "MIN", "MAX"]);

/** Compile an expression node to a JS expression string. */
export function compileExpr(expression: Expression): string {
  switch (expression.type) {
    case "literal_string":
      return JSON.stringify(expression.value);
    case "literal_number":
      return String(expression.value);
    case "literal_boolean":
      return expression.value ? "true" : "false";
    case "literal_null":
      return "null";

    case "column_ref": {
      if (expression.name.startsWith("$")) {
        return "runtime.get(ctx.params, " + JSON.stringify(expression.name.slice(1)) + ")";
      }
      return "runtime.get(ctx.row, " + JSON.stringify(expression.name) + ")";
    }

    case "property_path": {
      const segments = expression.segments.map((s) => s.name);
      return "runtime.getPath(ctx.row, " + JSON.stringify(segments) + ")";
    }

    case "old_new_ref": {
      const source = expression.kind === "old" ? "ctx.old" : "ctx.new";
      if (expression.property) {
        return "runtime.get(" + source + ", " + JSON.stringify(expression.property.name) + ")";
      }
      return source;
    }

    case "binary_expr":
      return compileBinary(expression);

    case "unary_expr":
      if (expression.operator === "NOT") {
        return "runtime.not(" + compileExpr(expression.operand) + ")";
      }
      return "runtime.neg(" + compileExpr(expression.operand) + ")";

    case "is_null_expr": {
      const helper = expression.not ? "isNotNull" : "isNull";
      return "runtime." + helper + "(" + compileExpr(expression.operand) + ")";
    }

    case "function_call":
      return compileFunctionCall(expression);

    case "cast_expr":
      return "runtime.cast(" + compileExpr(expression.operand) + ", " + JSON.stringify(expression.targetType) + ")";

    default:
      throw new Error("Unsupported expression node: " + String((expression as { type: string }).type));
  }
}

/** Compile an expression to a full closure over the evaluation context. */
export function compileExpression(expression: Expression): string {
  return "(ctx) => " + compileExpr(expression);
}

function compileBinary(expression: BinaryExpr): string {
  const op = expression.operator;

  // Logical operators short-circuit via a thunk to preserve three-valued semantics.
  if (op === "AND") {
    return "runtime.and(" + compileExpr(expression.left) + ", () => " + compileExpr(expression.right) + ")";
  }
  if (op === "OR") {
    return "runtime.or(" + compileExpr(expression.left) + ", () => " + compileExpr(expression.right) + ")";
  }

  const left = compileExpr(expression.left);
  const right = compileExpr(expression.right);

  const comparison = COMPARISON[op];
  if (comparison) {
    return "runtime." + comparison + "(" + left + ", " + right + ")";
  }

  const arithmetic = ARITHMETIC[op];
  if (arithmetic) {
    return "runtime." + arithmetic + "(" + left + ", " + right + ")";
  }

  throw new Error("Unsupported binary operator: " + op);
}

function compileFunctionCall(expression: FunctionCall): string {
  const name = expression.name.toUpperCase();

  if (AGGREGATES.has(name)) {
    throw new Error(name + "() is an aggregate and is not available in row expressions");
  }

  const scalar = SCALAR_FUNCTIONS[name];
  if (scalar) {
    const args = expression.args.map(compileExpr).join(", ");
    return "runtime." + scalar + "(" + args + ")";
  }

  if (name === "CAST") {
    if (expression.args.length !== 2) {
      throw new Error("CAST() requires a value and a type");
    }
    const typeArg = expression.args[1]!;
    const typeValue = typeArg.type === "literal_string" ? typeArg.value : typeArg.type === "column_ref" ? typeArg.name : "TEXT";
    return "runtime.cast(" + compileExpr(expression.args[0]!) + ", " + JSON.stringify(typeValue) + ")";
  }

  throw new Error("Unknown function: " + expression.name);
}
