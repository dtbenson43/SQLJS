export interface CssRuleRow extends Record<string, unknown> {
  selector: string;
  property: string;
  value: string;
  important: boolean;
}

export type StateTable = Record<string, unknown>[];

const cssRuleTargets = new WeakMap<object, CssRuleTarget>();
const stateTables = new Map<string, StateTable>();

interface CssRuleTarget {
  rule: CSSStyleRule;
  property: string;
}

export function registerTable(name: string, rows: readonly Record<string, unknown>[]): void {
  const tableName = normalizeStateName(name);
  if (!tableName) throw new Error("State table name cannot be empty");
  stateTables.set(tableName, rows as StateTable);
}

export function clearTables(): void {
  stateTables.clear();
}

export function getStateTable(name: string, supplied?: Record<string, readonly Record<string, unknown>[]>): StateTable | undefined {
  const normalized = normalizeStateName(name);
  const fromOptions = supplied && (supplied[name] ?? supplied[normalized] ?? supplied[normalized.slice(6)]);
  if (fromOptions) return fromOptions as StateTable;
  return stateTables.get(normalized);
}

export function isCssRulesTable(table: string | undefined): boolean {
  return (table ?? "").toLowerCase() === "css.rules";
}

export function isStateTable(table: string | undefined): boolean {
  return (table ?? "").toLowerCase().startsWith("state.");
}

export function readCssRules(root: Document | Element): CssRuleRow[] {
  const document = (root.ownerDocument ?? root) as Document;
  const sheets = document.styleSheets;
  if (!sheets) return [];
  const rows: CssRuleRow[] = [];
  for (let stylesheetIndex = 0; stylesheetIndex < sheets.length; stylesheetIndex++) {
    let rules: CSSRuleList;
    try {
      rules = sheets[stylesheetIndex]!.cssRules;
    } catch {
      // Cross-origin stylesheets are not readable from the browser; skip them.
      continue;
    }
    for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
      const rule = rules[ruleIndex];
      if (!rule || rule.type !== 1 || !("style" in rule)) continue;
      const cssRule = rule as CSSStyleRule;
      const style = cssRule.style;
      for (let propertyIndex = 0; propertyIndex < style.length; propertyIndex++) {
        const property = style.item(propertyIndex);
        if (!property) continue;
        const row: CssRuleRow = {
          selector: cssRule.selectorText,
          property,
          value: style.getPropertyValue(property),
          important: style.getPropertyPriority(property) === "important",
        };
        cssRuleTargets.set(row, { rule: cssRule, property });
        rows.push(row);
      }
    }
  }
  return rows;
}

export function setCssRuleProperty(row: Record<string, unknown>, path: string, value: unknown): unknown {
  const target = cssRuleTargets.get(row);
  if (!target) throw new Error("CSS rule row is not writable");
  const previous = row[path];
  if (path.toLowerCase() === "value") {
    target.rule.style.setProperty(target.property, value == null ? "" : String(value), row.important ? "important" : "");
    row.value = value == null ? "" : String(value);
    return previous;
  }
  if (path.toLowerCase() === "important") {
    target.rule.style.setProperty(target.property, String(row.value ?? ""), value ? "important" : "");
    row.important = Boolean(value);
    return previous;
  }
  if (path.toLowerCase() === "selector") {
    target.rule.selectorText = String(value ?? "");
    row.selector = target.rule.selectorText;
    return previous;
  }
  throw new Error(`Cannot update CSS.Rules column: ${path}`);
}

export function setStateProperty(row: Record<string, unknown>, path: string, value: unknown): unknown {
  const segments = path.split(".");
  let previous: unknown = row;
  for (const segment of segments) {
    if (previous == null || typeof previous !== "object") {
      previous = undefined;
      break;
    }
    previous = (previous as Record<string, unknown>)[segment];
  }
  let target = row;
  for (const segment of segments.slice(0, -1)) {
    const next = target[segment];
    if (!next || typeof next !== "object") target[segment] = {};
    target = target[segment] as Record<string, unknown>;
  }
  target[segments[segments.length - 1]!] = value;
  return previous;
}

export function deleteStateRow(rows: StateTable, row: Record<string, unknown>): number {
  const index = rows.indexOf(row);
  if (index < 0) return -1;
  rows.splice(index, 1);
  return index;
}

export function insertStateRow(rows: StateTable, row: Record<string, unknown>, index?: number): void {
  if (index === undefined || index < 0 || index > rows.length) rows.push(row);
  else rows.splice(index, 0, row);
}

function normalizeStateName(name: string): string {
  const trimmed = name.trim();
  return trimmed.toLowerCase().startsWith("state.") ? trimmed.toLowerCase() : `state.${trimmed}`.toLowerCase();
}
