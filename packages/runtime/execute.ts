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
import { getStateTable, isCssRulesTable, isStateTable, readCssRules, setCssRuleProperty, setStateProperty } from "./data-sources";

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
  tables?: Record<string, readonly Record<string, unknown>[]>;
  onEvent?: (event: RuntimeEvent) => void;
}

export interface RuntimeEvent {
  trigger: string;
  event: string;
  target: Element;
  messages: RuntimeMessage[];
}

// -- Mutation record ----------------------------------------------

export interface MutationRecord {
  element: Element;
  property: string;
  oldValue: unknown;
  newValue: unknown;
  parent?: Element | null;
  nextSibling?: Node | null;
  restore?: () => void;
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
  tables?: Record<string, readonly Record<string, unknown>[]>;
  onEvent?: (event: RuntimeEvent) => void;
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

  return executeProgram(program, options);
}

/** Execute an already parsed program without parsing SQL again. */
export function executeProgram(
  program: Program,
  options: ExecutionOptions
): QueryResult {
  const start = performance.now();

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
    tables: options.tables,
    onEvent: options.onEvent,
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
  if (stmt.source.type === "global" && stmt.source.table && stmt.source.table.toUpperCase() !== "ELEMENTS") {
    const dataRows = resolveDataRows(state, stmt.source.table);
    return projectRows(dataRows, stmt, state);
  }
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

function projectRows(rows: Record<string, unknown>[], stmt: SelectStatement, state: ExecutionState): StmtResult {
  const evalContext = {
    params: state.params,
    old: state.oldValues,
    new: state.newValues,
    row: undefined as Record<string, unknown> | undefined,
  };
  const resultRows: Record<string, unknown>[] = [];
  for (const row of rows) {
    evalContext.row = row;
    if (stmt.where && !isSqlTrue(evaluateExpression(stmt.where, evalContext as any))) continue;
    const projected: Record<string, unknown> = {};
    if (stmt.columns.length === 1 && stmt.columns[0]!.type === "star") {
      Object.assign(projected, row);
    } else {
      for (const col of stmt.columns) {
        if (col.type === "star") Object.assign(projected, row);
        else projected[col.alias ?? columnName(col.expr as Expression)] = evaluateExpression(col.expr as Expression, evalContext as any);
      }
    }
    resultRows.push(projected);
  }
  const columns = stmt.columns.length === 1 && stmt.columns[0]!.type === "star"
    ? (resultRows.length > 0 ? Object.keys(resultRows[0]!) : [])
    : stmt.columns.map((col) => col.type === "star" ? "*" : col.alias ?? columnName(col.expr as Expression));
  return { columns, rows: resultRows };
}

function resolveDataRows(state: ExecutionState, table: string): Record<string, unknown>[] {
  if (isCssRulesTable(table)) return readCssRules(state.root);
  if (isStateTable(table)) {
    const rows = getStateTable(table, state.tables);
    if (!rows) throw new Error(`Unknown state table: ${table}`);
    return rows;
  }
  throw new Error(`Unknown table: ${table}`);
}

function columnName(expr: Expression): string {
  if (expr.type === "column_ref") return expr.name;
  if (expr.type === "property_path") return expr.segments.map((s) => s.name).join(".");
  return formatExpression(expr);
}

// -- UPDATE -------------------------------------------------------

function executeUpdate(stmt: UpdateStatement, state: ExecutionState): StmtResult {
  if (stmt.source.type === "global" && stmt.source.table && stmt.source.table.toUpperCase() !== "ELEMENTS") {
    return executeDataUpdate(stmt, state, resolveDataRows(state, stmt.source.table), stmt.source.table);
  }
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

function executeDataUpdate(stmt: UpdateStatement, state: ExecutionState, rows: Record<string, unknown>[], table: string): StmtResult {
  const evalContext = { params: state.params, old: state.oldValues, new: state.newValues, row: undefined as Record<string, unknown> | undefined };
  let affected = 0;
  for (const row of rows) {
    evalContext.row = row;
    if (stmt.where && !isSqlTrue(evaluateExpression(stmt.where, evalContext as any))) continue;
    for (const assignment of stmt.assignments) {
      const path = assignment.target.segments.map((segment) => segment.name).join(".");
      const value = evaluateExpression(assignment.value as Expression, evalContext as any);
      const oldValue = table.toLowerCase() === "css.rules"
        ? setCssRuleProperty(row, path, value)
        : setStateProperty(row, path, value);
      state.mutations.push({
        element: row as unknown as Element,
        property: path,
        oldValue,
        newValue: value,
        restore: () => table.toLowerCase() === "css.rules"
          ? setCssRuleProperty(row, path, oldValue)
          : setStateProperty(row, path, oldValue),
      });
    }
    affected++;
  }
  return { columns: [], rows: [], affectedRows: affected };
}

function executeDataInsert(stmt: InsertStatement, state: ExecutionState, table: string): StmtResult {
  const rows = getStateTable(table, state.tables);
  if (!rows) throw new Error(`Unknown state table: ${table}`);
  const returning: Record<string, unknown>[] = [];
  for (const expressions of stmt.values) {
    const row: Record<string, unknown> = {};
    for (let index = 0; index < expressions.length; index++) {
      const name = stmt.columns[index]?.name;
      if (!name) continue;
      row[name] = evaluateExpression(expressions[index]!, { params: state.params, row });
    }
    rows.push(row);
    state.mutations.push({
      element: row as unknown as Element,
      property: "<state-insert>",
      oldValue: null,
      newValue: row,
      restore: () => { const index = rows.indexOf(row); if (index >= 0) rows.splice(index, 1); },
    });
    if (stmt.returning) returning.push(Object.fromEntries(stmt.returning.map((column) => [column.name, row[column.name]])));
  }
  return { columns: stmt.returning?.map((column) => column.name) ?? [], rows: returning, affectedRows: stmt.values.length };
}

// -- INSERT -------------------------------------------------------

function executeInsert(stmt: InsertStatement, state: ExecutionState): StmtResult {
  if (stmt.source.type === "global" && stmt.source.table && isStateTable(stmt.source.table)) {
    return executeDataInsert(stmt, state, stmt.source.table);
  }
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
  if (stmt.source.type === "global" && stmt.source.table && isStateTable(stmt.source.table)) {
    const rows = getStateTable(stmt.source.table, state.tables);
    if (!rows) throw new Error(`Unknown state table: ${stmt.source.table}`);
    const evalContext = { params: state.params, old: state.oldValues, new: state.newValues, row: undefined as Record<string, unknown> | undefined };
    const removed: Record<string, unknown>[] = [];
    for (const row of [...rows]) {
      evalContext.row = row;
      if (!stmt.where || isSqlTrue(evaluateExpression(stmt.where, evalContext as any))) removed.push(row);
    }
    for (const row of removed) {
      const index = rows.indexOf(row);
      if (index >= 0) rows.splice(index, 1);
      state.mutations.push({ element: row as unknown as Element, property: "<state-delete>", oldValue: row, newValue: null,
        restore: () => rows.splice(Math.min(index, rows.length), 0, row) });
    }
    return { columns: [], rows: [], affectedRows: removed.length };
  }
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
    if (m.restore) {
      m.restore();
    } else if (m.property === "<insert>") {
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
const persistentTriggers = new WeakMap<object, TriggerRegistration[]>();
const attachedEventNames = new WeakMap<object, Set<string>>();

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
  const registration = state.triggers[state.triggers.length - 1]!;
  const owner = (state.root.ownerDocument ?? state.root) as Document;
  const registrations = persistentTriggers.get(owner) ?? [];
  registrations.push(registration);
  persistentTriggers.set(owner, registrations);
  if (registration.event.type === "event") attachEventListener(owner, registration.event.name, state.onEvent);

  const label = stmt.target.kind === "id" ? "#" + stmt.target.value : "." + stmt.target.value;
  const eventLabel = stmt.event.type === "event" ? stmt.event.name : "UPDATE" + (column ? " OF " + column : "");
  state.messages.push({
    text: "Trigger '" + stmt.name + "' registered for " + eventLabel + " on " + label,
    level: "info",
  });
}

function attachEventListener(document: Document, eventName: string, onEvent?: (event: RuntimeEvent) => void): void {
  const key = document as unknown as object;
  const names = attachedEventNames.get(key) ?? new Set<string>();
  if (names.has(eventName)) return;
  names.add(eventName);
  attachedEventNames.set(key, names);
  if (typeof document.addEventListener !== "function") return;
  document.addEventListener(eventName.toLowerCase(), (event) => {
    const target = event.target as (Element & { tagName?: string }) | null;
    if (!target || typeof target.tagName !== "string") return;
    const registrations = persistentTriggers.get(key) ?? [];
    for (const trigger of registrations) {
      if (trigger.event.type !== "event" || trigger.event.name !== eventName || !matchesTriggerTarget(target, trigger)) continue;
      const messages: RuntimeMessage[] = [];
      const eventState: ExecutionState = {
        root: document, params: {}, messages, mutations: [], transactionActive: false,
        triggers: registrations, triggerStack: [], onEvent,
      };
      try {
        for (const statement of trigger.body) executeStatement(statement, eventState);
      } catch (error) {
        messages.push({ text: error instanceof Error ? error.message : String(error), level: "error" });
      }
      onEvent?.({ trigger: trigger.name, event: eventName, target, messages });
    }
  });
}

function matchesTriggerTarget(element: Element, trigger: TriggerRegistration): boolean {
  if (trigger.targetKind === "id") return element.id === trigger.targetValue;
  if (trigger.targetKind === "class") {
    const className = (element as HTMLElement).className;
    return typeof className === "string" && className.split(/\s+/).includes(trigger.targetValue);
  }
  return trigger.targetValue.toUpperCase() === "ELEMENTS" || element.tagName.toUpperCase() === trigger.targetValue.toUpperCase();
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
