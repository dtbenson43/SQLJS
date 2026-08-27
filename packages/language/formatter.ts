// AST formatter - converts an AST back to SQL text (for display/debugging).

import {
  Program, Statement, Expression,
  SelectStatement, UpdateStatement, InsertStatement, DeleteStatement,
  BeginTransaction, CommitStatement, RollbackStatement,
  CreateTriggerStatement,
  SelectColumn, QuerySource, Assignment,
  Identifier, PropertyPath, ElementSelector,
  StringLiteral, NumberLiteral, BooleanLiteral, NullLiteral,
  ColumnRef, BinaryExpr, UnaryExpr, IsNullExpr,
  FunctionCall, CastExpr, OldNewRef,
} from "./ast";

export function formatProgram(program: Program): string {
  return program.statements.map(formatStatement).join(";\n") + ";";
}

export function formatStatement(stmt: Statement): string {
  switch (stmt.type) {
    case "select": return formatSelect(stmt);
    case "update": return formatUpdate(stmt);
    case "insert": return formatInsert(stmt);
    case "delete": return formatDelete(stmt);
    case "begin_transaction": return "BEGIN TRANSACTION";
    case "commit": return "COMMIT";
    case "rollback": return "ROLLBACK";
    case "create_trigger": return formatCreateTrigger(stmt);
  }
}

function formatSelect(stmt: SelectStatement): string {
  const cols = stmt.columns
    .map((c) => c.type === "star" ? "*" : formatExpression(c.expr) + (c.alias ? " AS " + c.alias : ""))
    .join(", ");
  let sql = "SELECT " + cols + " FROM " + formatSource(stmt.source);
  if (stmt.where) sql += " WHERE " + formatExpression(stmt.where);
  return sql;
}

function formatUpdate(stmt: UpdateStatement): string {
  const sets = stmt.assignments
    .map((a) => formatPropertyPath(a.target) + " = " + formatExpression(a.value))
    .join(", ");
  let sql = "UPDATE " + formatSource(stmt.source) + " SET " + sets;
  if (stmt.where) sql += " WHERE " + formatExpression(stmt.where);
  return sql;
}

function formatInsert(stmt: InsertStatement): string {
  let sql = "INSERT INTO " + formatSource(stmt.source);
  if (stmt.columns.length > 0) {
    sql += " (" + stmt.columns.map((c) => c.name).join(", ") + ")";
  }
  sql += " VALUES " + stmt.values
    .map((row) => "(" + row.map(formatExpression).join(", ") + ")")
    .join(", ");
  if (stmt.returning && stmt.returning.length > 0) {
    sql += " RETURNING " + stmt.returning.map((c) => c.name).join(", ");
  }
  return sql;
}

function formatDelete(stmt: DeleteStatement): string {
  let sql = "DELETE FROM " + formatSource(stmt.source);
  if (stmt.where) sql += " WHERE " + formatExpression(stmt.where);
  return sql;
}

function formatCreateTrigger(stmt: CreateTriggerStatement): string {
  const eventStr = stmt.event.type === "event"
    ? stmt.event.name
    : "UPDATE" + (stmt.updateColumn ? " OF " + stmt.updateColumn : "");
  let sql = "CREATE TRIGGER " + stmt.name
    + " ON " + formatSelector(stmt.target)
    + " AFTER " + eventStr
    + " AS BEGIN "
    + stmt.body.map(formatStatement).join("; ")
    + " END";
  return sql;
}

function formatSource(source: QuerySource): string {
  switch (source.type) {
    case "global": return source.table ?? "Elements";
    case "scoped": return formatSelector(source.selector);
    case "children": return "CHILDREN(" + formatSelector(source.selector) + ")";
    case "descendants": return "DESCENDANTS(" + formatSelector(source.selector) + ")";
    case "parent": return "PARENT OF " + formatSelector(source.selector);
  }
}

function formatSelector(sel: ElementSelector): string {
  switch (sel.kind) {
    case "id": return "#" + sel.value;
    case "class": return "." + sel.value;
    case "name": return sel.value;
  }
}

export function formatExpression(expr: Expression): string {
  switch (expr.type) {
    case "literal_string": return "'" + expr.value.replace(/'/g, "''") + "'";
    case "literal_number": return String(expr.value);
    case "literal_boolean": return expr.value ? "TRUE" : "FALSE";
    case "literal_null": return "NULL";
    case "column_ref": return expr.name;
    case "old_new_ref": return expr.kind.toUpperCase() + (expr.property ? "." + expr.property.name : "");
    case "binary_expr": return formatExpression(expr.left) + " " + expr.operator + " " + formatExpression(expr.right);
    case "unary_expr": return expr.operator + " " + formatExpression(expr.operand);
    case "is_null_expr": return formatExpression(expr.operand) + (expr.not ? " IS NOT NULL" : " IS NULL");
    case "function_call": return expr.name + "(" + expr.args.map(formatExpression).join(", ") + ")";
    case "cast_expr": return "CAST(" + formatExpression(expr.operand) + " AS " + expr.targetType + ")";
    case "property_path": return formatPropertyPath(expr);
  }
}

function formatPropertyPath(path: PropertyPath): string {
  return path.segments.map((s) => s.name).join(".");
}
