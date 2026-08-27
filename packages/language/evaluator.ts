import {
  BinaryExpr,
  CastExpr,
  ColumnRef,
  Expression,
  FunctionCall,
  IsNullExpr,
  PropertyPath,
  UnaryExpr,
} from "./ast";

/** Values understood by the expression evaluator. Objects are allowed so
 * property paths can be resolved against row-shaped values. */
export type SqlValue = string | number | boolean | null | undefined | Record<string, unknown>;

export interface EvaluationContext {
  /** The current row, normally an element-row adapter result. */
  row?: Record<string, unknown>;
  /** Pseudo-row values available to mutation triggers. */
  old?: Record<string, unknown>;
  new?: Record<string, unknown>;
  /** Named parameters such as $username. */
  params?: Record<string, unknown>;
  /** Optional application-defined scalar functions. */
  functions?: Record<string, (...args: unknown[]) => unknown>;
}

export class EvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationError";
  }
}

/** A compiled expression is a function over the evaluation context. */
export type CompiledExpression = (context: EvaluationContext) => unknown;

/** Either a parsed expression or an already-compiled expression. */
export type Evaluable = Expression | CompiledExpression;

/** Evaluate one parsed or compiled expression without compiling it to JavaScript. */
export function evaluateExpression(expression: Evaluable, context: EvaluationContext = {}): unknown {
  if (typeof expression === "function") {
    return (expression as CompiledExpression)(context);
  }
  switch (expression.type) {
    case "literal_string":
    case "literal_number":
    case "literal_boolean":
      return expression.value;
    case "literal_null":
      return null;
    case "column_ref":
      return resolveColumn(expression, context);
    case "property_path":
      return resolvePath(expression, context.row);
    case "old_new_ref": {
      const source = expression.kind === "old" ? context.old : context.new;
      return expression.property ? lookup(source, expression.property.name) : source;
    }
    case "binary_expr":
      return evaluateBinary(expression, context);
    case "unary_expr":
      return evaluateUnary(expression, context);
    case "is_null_expr":
      {
        const value = evaluateExpression(expression.operand, context);
        return expression.not ? value !== null && value !== undefined : value === null || value === undefined;
      }
    case "function_call":
      return evaluateFunction(expression, context);
    case "cast_expr":
      return castValue(evaluateExpression(expression.operand, context), expression.targetType);
    default:
      return assertNever(expression);
  }
}

/** SQL WHERE semantics: NULL/undefined do not select a row. */
export function isSqlTrue(value: unknown): boolean {
  return value === true || (typeof value === "number" && value !== 0) || (typeof value === "string" && value.length > 0);
}

function evaluateBinary(expression: BinaryExpr, context: EvaluationContext): unknown {
  if (expression.operator === "AND" || expression.operator === "OR") {
    return evaluateLogical(expression.operator, expression.left, expression.right, context);
  }

  const left = evaluateExpression(expression.left, context);
  const right = evaluateExpression(expression.right, context);
  if (left == null || right == null) return null;

  switch (expression.operator) {
    case "=": return left === right;
    case "!=":
    case "<>": return left !== right;
    case "<": return compare(left, right) < 0;
    case "<=": return compare(left, right) <= 0;
    case ">": return compare(left, right) > 0;
    case ">=": return compare(left, right) >= 0;
    case "LIKE": return like(String(left), String(right));
    case "+": return arithmetic(left, right, "+");
    case "-": return arithmetic(left, right, "-");
    case "*": return arithmetic(left, right, "*");
    case "/": return arithmetic(left, right, "/");
    default: return assertNever(expression.operator);
  }
}

function evaluateLogical(operator: "AND" | "OR", leftExpression: Expression, rightExpression: Expression, context: EvaluationContext): boolean | null {
  const left = toSqlBoolean(evaluateExpression(leftExpression, context));
  // Short-circuit only where SQL's three-valued result is already known.
  if (operator === "AND" && left === false) return false;
  if (operator === "OR" && left === true) return true;
  const right = toSqlBoolean(evaluateExpression(rightExpression, context));
  if (operator === "AND") {
    if (right === false) return false;
    return left === null || right === null ? null : true;
  }
  if (right === true) return true;
  return left === null || right === null ? null : false;
}

function evaluateUnary(expression: UnaryExpr, context: EvaluationContext): unknown {
  const value = evaluateExpression(expression.operand, context);
  if (expression.operator === "NOT") {
    const boolean = toSqlBoolean(value);
    return boolean === null ? null : !boolean;
  }
  if (value == null) return null;
  return -toNumber(value);
}

function evaluateFunction(expression: FunctionCall, context: EvaluationContext): unknown {
  const name = expression.name.toUpperCase();
  const args = expression.args.map((arg) => evaluateExpression(arg, context));
  const custom = context.functions?.[name];
  if (custom) return custom(...args);

  switch (name) {
    case "LEN": return args[0] == null ? null : String(args[0]).length;
    case "LOWER": return args[0] == null ? null : String(args[0]).toLowerCase();
    case "UPPER": return args[0] == null ? null : String(args[0]).toUpperCase();
    case "COALESCE": return args.find((value) => value !== null && value !== undefined) ?? null;
    case "CAST":
      if (args.length !== 2 || typeof args[1] !== "string") throw new EvaluationError("CAST() requires a value and a type");
      return castValue(args[0], args[1]);
    case "COUNT":
      throw new EvaluationError("COUNT() is an aggregate and is not available in row expressions");
    default:
      throw new EvaluationError(`Unknown function: ${expression.name}`);
  }
}

function resolveColumn(column: ColumnRef, context: EvaluationContext): unknown {
  const name = column.name;
  if (name.startsWith("$")) return lookup(context.params, name.slice(1));
  return lookup(context.row, name);
}

function resolvePath(path: PropertyPath, object: Record<string, unknown> | undefined): unknown {
  if (!object) return undefined;
  let value: unknown = object;
  for (const segment of path.segments) {
    if (value == null || typeof value !== "object") return undefined;
    value = lookup(value as Record<string, unknown>, segment.name);
  }
  return value;
}

export function lookup(object: Record<string, unknown> | undefined, name: string): unknown {
  if (!object) return undefined;
  if (Object.prototype.hasOwnProperty.call(object, name)) return object[name];
  const key = Object.keys(object).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : object[key];
}

export function toSqlBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "false" || trimmed === "0") return false;
    if (trimmed === "true" || trimmed === "1") return true;
    return value.length > 0;
  }
  return true;
}

export function compare(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function arithmetic(left: unknown, right: unknown, operator: "+" | "-" | "*" | "/"): number | string {
  if (operator === "+" && (typeof left === "string" || typeof right === "string")) return String(left) + String(right);
  const a = toNumber(left);
  const b = toNumber(right);
  if (operator === "/" && b === 0) throw new EvaluationError("Division by zero");
  switch (operator) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return a / b;
  }
}

export function toNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new EvaluationError(`Cannot convert value to number: ${String(value)}`);
  return number;
}

export function castValue(value: unknown, targetType: string): unknown {
  if (value == null) return null;
  switch (targetType.toUpperCase()) {
    case "INT":
    case "INTEGER": return Math.trunc(toNumber(value));
    case "DECIMAL":
    case "FLOAT":
    case "REAL": return toNumber(value);
    case "TEXT":
    case "VARCHAR":
    case "STRING": return String(value);
    case "BOOLEAN":
    case "BOOL": return toSqlBoolean(value) === true;
    default: throw new EvaluationError(`Unsupported CAST type: ${targetType}`);
  }
}

export function like(value: string, pattern: string): boolean {
  let expression = "^";
  for (let i = 0; i < pattern.length; i++) {
    const character = pattern[i]!;
    if (character === "%") expression += ".*";
    else if (character === "_") expression += ".";
    else expression += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(expression + "$", "is").test(value);
}

function assertNever(value: never): never {
  throw new EvaluationError(`Unsupported expression node: ${String(value)}`);
}
