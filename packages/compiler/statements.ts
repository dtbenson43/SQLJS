// Statement compiler: compiles a statement AST to a JavaScript object literal.
// Expressions become closures; statement structure stays as plain data consumed
// by the shared runtime executor.

import { Program, Statement, SelectStatement, UpdateStatement, InsertStatement, DeleteStatement, CreateTriggerStatement, QuerySource } from "../language/ast";
import { compileExpression, compileExpr } from "./expressions";

const DUMMY_SPAN = '{ start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } }';

/** Compile a full program to a JS object literal expression. */
export function compileProgramObject(program: Program): string {
  const statements = program.statements.map(compileStatementObject).join(", ");
  return '{ type: "program", span: ' + DUMMY_SPAN + ', statements: [' + statements + '] }';
}

/** Compile one statement to a JS object literal. */
export function compileStatementObject(statement: Statement): string {
  switch (statement.type) {
    case "select": return compileSelect(statement);
    case "update": return compileUpdate(statement);
    case "insert": return compileInsert(statement);
    case "delete": return compileDelete(statement);
    case "begin_transaction": return '{ type: "begin_transaction", span: ' + DUMMY_SPAN + ' }';
    case "commit": return '{ type: "commit", span: ' + DUMMY_SPAN + ' }';
    case "rollback": return '{ type: "rollback", span: ' + DUMMY_SPAN + ' }';
    case "create_trigger": return compileCreateTrigger(statement);
  }
}

function compileSource(source: QuerySource): string {
  switch (source.type) {
    case "global":
      return '{ type: "global", span: ' + DUMMY_SPAN + (source.table ? ', table: ' + JSON.stringify(source.table) : '') + ' }';
    case "scoped":
    case "children":
    case "descendants":
    case "parent":
      return '{ type: ' + JSON.stringify(source.type) + ', selector: ' + compileSelector(source.selector) + ', span: ' + DUMMY_SPAN + ' }';
  }
}

function compileSelector(selector: { kind: string; value: string }): string {
  return '{ type: "element_selector", kind: ' + JSON.stringify(selector.kind) + ', value: ' + JSON.stringify(selector.value) + ', span: ' + DUMMY_SPAN + ' }';
}

function compileSelect(statement: SelectStatement): string {
  const columns = statement.columns.map((col) => {
    if (col.type === "star") {
      return '{ type: "star", span: ' + DUMMY_SPAN + ' }';
    }
    return '{ type: "column", expr: ' + compileExpression(col.expr) + ', alias: ' + JSON.stringify(col.alias ?? columnAlias(col.expr)) + ', span: ' + DUMMY_SPAN + ' }';
  }).join(", ");

  const where = statement.where ? ', where: ' + compileExpression(statement.where) : '';
  return '{ type: "select", span: ' + DUMMY_SPAN + ', columns: [' + columns + '], source: ' + compileSource(statement.source) + where + ' }';
}

function compileUpdate(statement: UpdateStatement): string {
  const assignments = statement.assignments.map((assignment) => {
    const segments = assignment.target.segments.map((s) => s.name);
    return '{ type: "assignment", span: ' + DUMMY_SPAN + ', target: { type: "property_path", segments: ' + JSON.stringify(segments.map((name) => ({ type: "identifier", name, span: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } } }))) + ', span: ' + DUMMY_SPAN + ' }, value: ' + compileExpression(assignment.value) + ' }';
  }).join(", ");

  const where = statement.where ? ', where: ' + compileExpression(statement.where) : '';
  return '{ type: "update", span: ' + DUMMY_SPAN + ', source: ' + compileSource(statement.source) + ', assignments: [' + assignments + ']' + where + ' }';
}

function compileInsert(statement: InsertStatement): string {
  const columns = '[' + statement.columns.map((c) => '{ type: "identifier", name: ' + JSON.stringify(c.name) + ', span: ' + DUMMY_SPAN + ' }').join(", ") + ']';
  const values = statement.values.map((row) => '[' + row.map((expr) => compileExpression(expr)).join(", ") + ']').join(", ");
  const returning = statement.returning && statement.returning.length > 0
    ? ', returning: [' + statement.returning.map((c) => '{ type: "identifier", name: ' + JSON.stringify(c.name) + ', span: ' + DUMMY_SPAN + ' }').join(", ") + ']'
    : '';
  return '{ type: "insert", span: ' + DUMMY_SPAN + ', source: ' + compileSource(statement.source) + ', columns: ' + columns + ', values: [' + values + ']' + returning + ' }';
}

function compileDelete(statement: DeleteStatement): string {
  const where = statement.where ? ', where: ' + compileExpression(statement.where) : '';
  return '{ type: "delete", span: ' + DUMMY_SPAN + ', source: ' + compileSource(statement.source) + where + ' }';
}

function compileCreateTrigger(statement: CreateTriggerStatement): string {
  const body = statement.body.map(compileStatementObject).join(", ");
  const event = statement.event.type === "mutation"
    ? '{ type: "mutation", name: "UPDATE" }'
    : '{ type: "event", name: ' + JSON.stringify(statement.event.name) + ' }';
  const updateColumn = statement.updateColumn ? ', updateColumn: ' + JSON.stringify(statement.updateColumn) : '';
  return '{ type: "create_trigger", span: ' + DUMMY_SPAN + ', name: ' + JSON.stringify(statement.name) + ', target: ' + compileSelector(statement.target) + ', event: ' + event + updateColumn + ', body: [' + body + '] }';
}

function columnAlias(expr: { type: string; name?: string; segments?: { name: string }[] }): string {
  if (expr.type === "column_ref" && expr.name) return expr.name;
  if (expr.type === "property_path" && expr.segments) return expr.segments.map((s) => s.name).join(".");
  return "expr";
}
