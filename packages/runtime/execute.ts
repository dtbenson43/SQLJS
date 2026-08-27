// Execution engine - parses SQL, runs it against a DOM, and returns results.
// The AST is the contract: the runtime never parses SQL independently.

import { Lexer } from "../language/lexer";
import { Parser } from "../language/parser";
import { ParseError, RuntimeError } from "../language/errors";
import {
  Program, Statement, SelectStatement, UpdateStatement,
  InsertStatement, DeleteStatement, CreateTriggerStatement,
  Expression,
} from "../language/ast";
import { evaluateExpression, isSqlTrue } from "../language/evaluator";
import { formatExpression } from "../language/formatter";
import { elementToRow, ElementRow, resolveElementSource, resolveSelector, setElementProperty, getElementProperty } from "./element-row";

// -- Public types -------------------------------------------------

export interface RuntimeMessage {
  text: string;
  level: "info" | "warning" | "error";
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  affectedRows?: number;
  messages: RuntimeMessage[];
  durationMs: number;
}

export interface ExecutionOptions {
  root: Document | Element;
  params?: Record<string, unknown>;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
}

// -- Mutation record ----------------------------------------------

export interface MutationRecord {
  element: Element;
  property: string;
  oldValue: unknown;
  newValue: unknown;
  parent?: Element | null;
  nextSibling?: Node | null;
}

// -- Execution state ----------------------------------------------

interface ExecutionState {
  root: Document | Element;
  params: Record<string, unknown>;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  messages: RuntimeMessage[];
  mutations: MutationRecord[];
  transactionActive: boolean;
  triggers: TriggerRegistration[];
  triggerStack: string[];
}

interface TriggerRegistration {
  name: string;
  targetKind: "id" | "class" | "name";
  targetValue: string;
  event: { type: "event"; name: string } | { type: "mutation"; name: "UPDATE"; column?: string };
  body: Statement[];
}

// -- Main entry point ---------------------------------------------

export function execute(
  source: string,
  options: ExecutionOptions
): QueryResult {
  const start = performance.now();

  // 1. Parse
  let program: Program;
  try {
    const lexer = new Lexer(source);
    const parser = new Parser(lexer.tokenize());
    program = parser.parse();
  } catch (err) {
    if (err instanceof ParseError) {
      const ms = performance.now() - start;
      return {
        columns: [],
        rows: [],
        messages: err.diagnostics.map((d) => ({ text: d.message, level: "error" })),
        durationMs: ms,
      };
    }
    throw err;
  }

  // 2. Execute each statement
  const state: ExecutionState = {
    root: options.root,
    params: options.params ?? {},
    oldValues: options.oldValues,
    newValues: options.newValues,
    messages: [],
    mutations: [],
    transactionActive: false,
    triggers: [],
    triggerStack: [],
  };

  const allColumns: string[] = [];
  const allRows: Record<string, unknown>[] = [];
  let totalAffected = 0;

  for (const stmt of program.statements) {
    try {
      const result = executeStatement(stmt, state);
      if (result) {
        for (const col of result.columns) {
          if (!allColumns.includes(col)) allColumns.push(col);
        }
        allRows.push(...result.rows);
        if (result.affectedRows !== undefined) totalAffected += result.affectedRows;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.messages.push({ text: msg, level: "error" });
    }
  }

  const ms = performance.now() - start;
  const hasErrors = state.messages.some((m) => m.level === "error");
  if (!hasErrors) {
    state.messages.push({ text: "Query executed successfully.", level: "info" });
  }
  if (totalAffected > 0) {
    const plural = totalAffected === 1 ? "" : "s";
    state.messages.push({
      text: "(" + totalAffected + " element" + plural + " affected)",
      level: "info",
    });
  }
  state.messages.push({
    text: "Execution time: " + ms.toFixed(1) + " ms",
    level: "info",
  });

  return {
    columns: allColumns,
    rows: allRows,
    affectedRows: totalAffected,
    messages: state.messages,
    durationMs: ms,
  };
}

// -- Statement dispatch -------------------------------------------

interface StmtResult {
  columns: string[];
  rows: Record<string, unknown>[];
  affectedRows?: number;
}

function executeStatement(stmt: Statement, state: ExecutionState): StmtResult | null {
  switch (stmt.type) {
    case "select": return executeSelect(stmt, state);
    case "update": return executeUpdate(stmt, state);
    case "insert": return executeInsert(stmt, state);
    case "delete": return executeDelete(stmt, state);
    case "begin_transaction":
      state.transactionActive = true;
      return null;
    case "commit":
      state.transactionActive = false;
      state.mutations = [];
      return null;
    case "rollback":
      rollback(state);
      return null;
    case "create_trigger":
      registerTrigger(stmt, state);
      return null;
  }
}

// -- SELECT -------------------------------------------------------

function executeSelect(stmt: SelectStatement, state: ExecutionState): StmtResult {
  const elements = resolveElementSource(state.root, stmt.source);
  const evalContext = {
    params: state.params,
    old: state.oldValues,
    new: state.newValues,
    row: undefined as Record<string, unknown> | undefined,
  };

  const rows: Record<string, unknown>[] = [];
  for (const element of elements) {
    const row = elementToRow(element) as unknown as Record<string, unknown>;
    evalContext.row = row;

    // WHERE filtering
    if (stmt.where) {
      const result = evaluateExpression(stmt.where, evalContext as any);
      if (!isSqlTrue(result)) continue;
    }

    // Project columns
    const hasStarOnly = stmt.columns.length === 1 && stmt.columns[0]!.type === "star";
    if (hasStarOnly) {
      rows.push({ ...row });
    } else {
      const projected: Record<string, unknown> = {};
      for (const col of stmt.columns) {
        if (col.type === "star") {
          Object.assign(projected, row);
        } else {
          const value = evaluateExpression(col.expr as Expression, evalContext as any);
          const name = col.alias ?? columnName(col.expr as Expression);
          projected[name] = value;
        }
      }
      rows.push(projected);
    }
  }

  const hasStarOnly = stmt.columns.length === 1 && stmt.columns[0]!.type === "star";
  let columns: string[];
  if (hasStarOnly) {
    columns = rows.length > 0
      ? Object.keys(rows[0]!)
      : ["id", "tag", "text", "html", "class", "value", "name", "type", "hidden", "disabled", "checked", "parentId"];
  } else {
    columns = stmt.columns.map((c) => {
      if (c.type === "star") return "*";
      return c.alias ?? columnName(c.expr as Expression);
    });
  }

  return { columns, rows };
}

function columnName(expr: Expression): string {
  if (expr.type === "column_ref") return expr.name;
  if (expr.type === "property_path") return expr.segments.map((s) => s.name).join(".");
  return formatExpression(expr);
}

// -- UPDATE -------------------------------------------------------

function executeUpdate(stmt: UpdateStatement, state: ExecutionState): StmtResult {
  const elements =
    stmt.source.type === "scoped"
      ? resolveSelector(state.root, stmt.source.selector)
      : resolveElementSource(state.root, stmt.source);
  const evalContext = {
    params: state.params,
    old: state.oldValues,
    new: state.newValues,
    row: undefined as Record<string, unknown> | undefined,
  };
  let affected = 0;

  for (const element of elements) {
    const oldRow = elementToRow(element) as unknown as Record<string, unknown>;
    evalContext.row = oldRow;

    if (stmt.where) {
      const result = evaluateExpression(stmt.where, evalContext as any);
      if (!isSqlTrue(result)) continue;
    }

    for (const assignment of stmt.assignments) {
      const value = evaluateExpression(assignment.value as Expression, evalContext as any);
      const propertyName = assignment.target.segments.map((s) => s.name).join(".");

      const oldValue = setElementProperty(element, assignment.target, value);
      state.mutations.push({ element, property: propertyName, oldValue, newValue: value });

      const newRow = { ...oldRow, [propertyName]: value };
      fireMutationTriggers(state, element, propertyName, oldRow, newRow);
    }
    affected++;
  }

  return { columns: [], rows: [], affectedRows: affected };
}

// -- INSERT -------------------------------------------------------

function executeInsert(stmt: InsertStatement, state: ExecutionState): StmtResult {
  let container: Element | undefined;
  if (stmt.source.type === "scoped") {
    const targets = resolveSelector(state.root, stmt.source.selector);
    container = targets[0];
  } else if (stmt.source.type === "children" || stmt.source.type === "descendants" || stmt.source.type === "parent") {
    const targets = resolveElementSource(state.root, stmt.source);
    container = targets[0];
  } else {
    const targets = resolveElementSource(state.root, stmt.source);
    container = targets[0] ?? ((state.root as Document).body ?? (state.root as Element));
  }

  if (!container) {
    throw new RuntimeError("No target element found for INSERT", {
      message: "No target element found for INSERT",
      line: stmt.span.start.line,
      column: stmt.span.start.column,
      length: stmt.span.end.offset - stmt.span.start.offset,
      severity: "error",
    });
  }

  const ownerDocument = (container.ownerDocument ?? container) as Document;
  if (!ownerDocument || typeof ownerDocument.createElement !== "function") {
    throw new RuntimeError("Cannot create elements without a document", {
      message: "Cannot create elements without a document",
      line: stmt.span.start.line,
      column: stmt.span.start.column,
      length: stmt.span.end.offset - stmt.span.start.offset,
      severity: "error",
    });
  }

  const returning: Record<string, unknown>[] = [];
  const evalContext = {
    params: state.params,
    old: state.oldValues,
    new: state.newValues,
    row: undefined as Record<string, unknown> | undefined,
  };

  for (const rowValues of stmt.values) {
    const tagIndex = stmt.columns.findIndex((c) => c.name.toLowerCase() === "tag");
    let tagName = "div";

    if (tagIndex >= 0 && rowValues[tagIndex]) {
      const evaluatedTag = evaluateExpression(rowValues[tagIndex] as Expression, evalContext as any);
      if (typeof evaluatedTag === "string" && evaluatedTag.length > 0) {
        tagName = evaluatedTag;
      }
    } else if (stmt.columns.length === 0 && rowValues[0]) {
      const evaluatedTag = evaluateExpression(rowValues[0] as Expression, evalContext as any);
      if (typeof evaluatedTag === "string" && evaluatedTag.length > 0) {
        tagName = evaluatedTag;
      }
    }

    const element = ownerDocument.createElement(tagName);
    const row = elementToRow(element) as unknown as Record<string, unknown>;
    evalContext.row = row;

    if (stmt.columns.length > 0) {
      for (let ci = 0; ci < stmt.columns.length; ci++) {
        const col = stmt.columns[ci]!;
        if (col.name.toLowerCase() === "tag") continue;
        if (ci >= rowValues.length) break;
        const val = evaluateExpression(rowValues[ci]! as Expression, evalContext as any);
        setElementProperty(element, col.name, val);
      }
    } else {
      const defaultCols = ["tag", "class", "text"];
      for (let ci = 1; ci < rowValues.length; ci++) {
        const colName = defaultCols[ci] ?? `attr_${ci}`;
        const val = evaluateExpression(rowValues[ci]! as Expression, evalContext as any);
        setElementProperty(element, colName, val);
      }
    }

    container.appendChild(element);
    state.mutations.push({ element, property: "<insert>", oldValue: null, newValue: element, parent: container });

    if (stmt.returning && stmt.returning.length > 0) {
      const projected: Record<string, unknown> = {};
      for (const col of stmt.returning) {
        projected[col.name] = col.name === "element" ? element : getElementProperty(element, col.name);
      }
      returning.push(projected);
    }
  }

  return {
    columns: stmt.returning ? stmt.returning.map((c) => c.name) : [],
    rows: returning,
    affectedRows: stmt.values.length,
  };
}

// -- DELETE -------------------------------------------------------

function executeDelete(stmt: DeleteStatement, state: ExecutionState): StmtResult {
  const elements =
    stmt.source.type === "scoped"
      ? resolveSelector(state.root, stmt.source.selector)
      : resolveElementSource(state.root, stmt.source);
  const evalContext = {
    params: state.params,
    old: state.oldValues,
    new: state.newValues,
    row: undefined as Record<string, unknown> | undefined,
  };
  let affected = 0;

  const toRemove: Element[] = [];
  for (const element of elements) {
    const row = elementToRow(element) as unknown as Record<string, unknown>;
    evalContext.row = row;

    if (stmt.where) {
      const result = evaluateExpression(stmt.where, evalContext as any);
      if (!isSqlTrue(result)) continue;
    }
    toRemove.push(element);
  }

  for (const element of toRemove) {
    const parent = element.parentElement;
    const nextSibling = (element as any).nextSibling as Node | null | undefined;
    element.parentElement?.removeChild(element);
    state.mutations.push({
      element,
      property: "<delete>",
      oldValue: element,
      newValue: null,
      parent: parent ?? null,
      nextSibling: nextSibling ?? null,
    });
    affected++;
  }

  return { columns: [], rows: [], affectedRows: affected };
}

// -- Transactions -------------------------------------------------

function rollback(state: ExecutionState): void {
  for (const m of [...state.mutations].reverse()) {
    if (m.property === "<insert>") {
      (m.element as Element).parentElement?.removeChild(m.element as Element);
    } else if (m.property === "<delete>") {
      if (m.parent) {
        if (m.nextSibling && typeof (m.parent as any).insertBefore === "function") {
          (m.parent as any).insertBefore(m.element, m.nextSibling);
        } else {
          m.parent.appendChild(m.element);
        }
      }
    } else {
      setElementProperty(m.element, m.property, m.oldValue);
    }
  }
  state.mutations = [];
  state.transactionActive = false;
}

// -- Triggers -----------------------------------------------------

const MAX_TRIGGER_DEPTH = 32;

function registerTrigger(stmt: CreateTriggerStatement, state: ExecutionState): void {
  const column = stmt.updateColumn;
  const event =
    stmt.event.type === "mutation"
      ? { type: "mutation" as const, name: "UPDATE" as const, column }
      : { type: "event" as const, name: stmt.event.name };

  state.triggers.push({
    name: stmt.name,
    targetKind: stmt.target.kind,
    targetValue: stmt.target.value,
    event,
    body: stmt.body,
  });

  const label = stmt.target.kind === "id" ? "#" + stmt.target.value : "." + stmt.target.value;
  const eventLabel = stmt.event.type === "event" ? stmt.event.name : "UPDATE" + (column ? " OF " + column : "");
  state.messages.push({
    text: "Trigger '" + stmt.name + "' registered for " + eventLabel + " on " + label,
    level: "info",
  });
}

function fireMutationTriggers(
  state: ExecutionState,
  element: Element,
  property: string,
  oldRow: Record<string, unknown>,
  newRow: Record<string, unknown>
): void {
  for (const trigger of state.triggers) {
    if (trigger.event.type !== "mutation") continue;
    if (trigger.event.column && trigger.event.column.toLowerCase() !== property.toLowerCase()) continue;

    let matches = false;
    if (trigger.targetKind === "id") {
      matches = element.id === trigger.targetValue;
    } else if (trigger.targetKind === "class") {
      const cls = (element as HTMLElement).className || "";
      matches = cls.split(/\s+/).includes(trigger.targetValue);
    } else if (trigger.targetKind === "name") {
      matches = trigger.targetValue.toUpperCase() === "ELEMENTS" || element.tagName.toUpperCase() === trigger.targetValue.toUpperCase();
    }

    if (!matches) continue;

    if (state.triggerStack.length >= MAX_TRIGGER_DEPTH) {
      const chain = [...state.triggerStack, trigger.name].join(" -> ");
      throw new RuntimeError("Trigger execution aborted: maximum trigger depth exceeded.\n" + chain, {
        message: "Trigger execution aborted: maximum trigger depth exceeded.\n" + chain,
        line: 0,
        column: 0,
        length: 0,
        severity: "error",
      });
    }

    state.triggerStack.push(trigger.name);
    try {
      const subState: ExecutionState = {
        ...state,
        oldValues: oldRow,
        newValues: newRow,
        params: { ...state.params },
      };
      for (const bodyStmt of trigger.body) {
        executeStatement(bodyStmt, subState);
      }
    } finally {
      state.triggerStack.pop();
    }
  }
}
