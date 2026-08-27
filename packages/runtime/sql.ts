// SQL expression helper boundary.
// Compiled JavaScript expressions call these helpers so that compiled semantics
// are identical to the interpreter's, without duplicating coercion logic.

import {
  lookup,
  toSqlBoolean,
  compare,
  arithmetic,
  toNumber,
  castValue,
  like as likeMatch,
} from "../language/evaluator";

// -- Comparison (NULL propagates) --------------------------------

export function sqlEq(left: unknown, right: unknown): unknown {
  if (left == null || right == null) return null;
  return left === right;
}

export function sqlNeq(left: unknown, right: unknown): unknown {
  if (left == null || right == null) return null;
  return left !== right;
}

export function sqlLt(left: unknown, right: unknown): unknown {
  if (left == null || right == null) return null;
  return compare(left, right) < 0;
}

export function sqlLte(left: unknown, right: unknown): unknown {
  if (left == null || right == null) return null;
  return compare(left, right) <= 0;
}

export function sqlGt(left: unknown, right: unknown): unknown {
  if (left == null || right == null) return null;
  return compare(left, right) > 0;
}

export function sqlGte(left: unknown, right: unknown): unknown {
  if (left == null || right == null) return null;
  return compare(left, right) >= 0;
}

export function sqlLike(left: unknown, right: unknown): unknown {
  if (left == null || right == null) return null;
  return likeMatch(String(left), String(right));
}

// -- Arithmetic (NULL propagates) --------------------------------

export function sqlAdd(left: unknown, right: unknown): unknown {
  if (left == null || right == null) return null;
  return arithmetic(left, right, "+");
}

export function sqlSub(left: unknown, right: unknown): unknown {
  if (left == null || right == null) return null;
  return arithmetic(left, right, "-");
}

export function sqlMul(left: unknown, right: unknown): unknown {
  if (left == null || right == null) return null;
  return arithmetic(left, right, "*");
}

export function sqlDiv(left: unknown, right: unknown): unknown {
  if (left == null || right == null) return null;
  return arithmetic(left, right, "/");
}

// -- Logical (SQL three-valued logic) ----------------------------

export function sqlNot(value: unknown): unknown {
  const b = toSqlBoolean(value);
  return b === null ? null : !b;
}

export function sqlNeg(value: unknown): unknown {
  if (value == null) return null;
  return -toNumber(value);
}

export function sqlIsNull(value: unknown): boolean {
  return value === null || value === undefined;
}

export function sqlIsNotNull(value: unknown): boolean {
  return value !== null && value !== undefined;
}

export function sqlAnd(left: unknown, rightThunk: () => unknown): unknown {
  const a = toSqlBoolean(left);
  if (a === false) return false;
  const b = toSqlBoolean(rightThunk());
  if (b === false) return false;
  return a === null || b === null ? null : true;
}

export function sqlOr(left: unknown, rightThunk: () => unknown): unknown {
  const a = toSqlBoolean(left);
  if (a === true) return true;
  const b = toSqlBoolean(rightThunk());
  if (b === true) return true;
  return a === null || b === null ? null : false;
}

// -- Lookups -----------------------------------------------------

export function sqlGet(object: Record<string, unknown> | undefined, name: string): unknown {
  return lookup(object, name);
}

export function sqlGetPath(object: Record<string, unknown> | undefined, segments: string[]): unknown {
  if (!object) return undefined;
  let value: unknown = object;
  for (const segment of segments) {
    if (value == null || typeof value !== "object") return undefined;
    value = lookup(value as Record<string, unknown>, segment);
  }
  return value;
}

// -- Casting and scalar functions --------------------------------

export function sqlCast(value: unknown, targetType: string): unknown {
  return castValue(value, targetType);
}

export function sqlLen(value: unknown): unknown {
  return value == null ? null : String(value).length;
}

export function sqlLower(value: unknown): unknown {
  return value == null ? null : String(value).toLowerCase();
}

export function sqlUpper(value: unknown): unknown {
  return value == null ? null : String(value).toUpperCase();
}

export function sqlCoalesce(...args: unknown[]): unknown {
  return args.find((v) => v !== null && v !== undefined) ?? null;
}

// -- Bundled boundary object -------------------------------------

export const sql = {
  get: sqlGet,
  getPath: sqlGetPath,
  eq: sqlEq,
  neq: sqlNeq,
  lt: sqlLt,
  lte: sqlLte,
  gt: sqlGt,
  gte: sqlGte,
  like: sqlLike,
  add: sqlAdd,
  sub: sqlSub,
  mul: sqlMul,
  div: sqlDiv,
  not: sqlNot,
  neg: sqlNeg,
  isNull: sqlIsNull,
  isNotNull: sqlIsNotNull,
  and: sqlAnd,
  or: sqlOr,
  cast: sqlCast,
  len: sqlLen,
  lower: sqlLower,
  upper: sqlUpper,
  coalesce: sqlCoalesce,
};
