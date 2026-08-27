import { Lexer } from "../language/lexer";
import { Parser } from "../language/parser";
import { Diagnostic, ParseError } from "../language/errors";
import { Program } from "../language/ast";

export interface PlaygroundExample {
  id: string;
  name: string;
  description: string;
  sql: string;
  html: string;
  css: string;
}

export const EXAMPLES: PlaygroundExample[] = [
  {
    id: "crud",
    name: "1. DOM Elements & CRUD",
    description: "SELECT, UPDATE, INSERT, and DELETE operations directly on DOM elements.",
    html: `<div id="app">
  <h1 class="title">Hello World</h1>
  <p class="description">This web page is queried and controlled with SQL.</p>
  <button id="change">Change Me</button>
  <div id="items"></div>
</div>`,
    css: `body { font-family: system-ui, -apple-system, sans-serif; padding: 1.5rem; background: #f8fafc; color: #0f172a; }
.title { color: #2563eb; margin-top: 0; }
.description { color: #64748b; font-size: 1.05rem; }
.highlight { background: #dbeafe; padding: 0.5rem 0.75rem; border-radius: 6px; }
.item { background: #ffffff; border: 1px solid #e2e8f0; padding: 0.6rem 0.9rem; margin-top: 0.5rem; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
button { background: #2563eb; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; font-weight: 500; cursor: pointer; }`,
    sql: `-- 1. Query all elements in the DOM
SELECT id, tag, text, class
FROM Elements;

-- 2. Update existing elements matching a pattern
UPDATE Elements
SET text = 'Welcome to SQL-DOM!',
    class = 'title highlight'
WHERE class LIKE '%title%';

-- 3. Insert new elements into the #items container
INSERT INTO #items (tag, class, text)
VALUES
  ('p', 'item', 'First dynamic item created from SQL'),
  ('p', 'item', 'Second dynamic item created from SQL');

-- 4. Delete the button element
DELETE FROM Elements
WHERE id = 'change';`,
  },
  {
    id: "triggers",
    name: "2. Event Triggers & Counter",
    description: "CREATE TRIGGER ... AFTER CLICK executing SQL on live browser events.",
    html: `<div id="app" style="text-align: center; padding: 2rem; max-width: 420px; margin: auto;">
  <h2 style="margin-top: 0; color: #0f172a;">Live SQL Counter</h2>
  <p style="color: #64748b; font-size: 0.95rem;">Button clicks fire SQL triggers defined in the runtime.</p>
  
  <div id="counter" style="font-size: 3.5rem; font-weight: 800; margin: 1.5rem 0; color: #2563eb; font-variant-numeric: tabular-nums;">0</div>
  
  <div style="display: flex; gap: 0.75rem; justify-content: center; align-items: center;">
    <button id="decrement" style="padding: 0.6rem 1.5rem; font-size: 1.25rem; font-weight: bold;">-</button>
    <button id="increment" style="padding: 0.6rem 1.5rem; font-size: 1.25rem; font-weight: bold;">+</button>
    <button id="reset-btn" style="padding: 0.6rem 1.2rem; font-size: 0.95rem; background: #64748b;">Reset</button>
  </div>
  
  <p id="status" style="margin-top: 1.5rem; padding: 0.5rem; background: #f1f5f9; border-radius: 6px; color: #475569; font-size: 0.9rem;">
    Ready. Click the buttons above!
  </p>
</div>`,
    css: `body { font-family: system-ui, -apple-system, sans-serif; background: #ffffff; color: #1e293b; }
button { background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; transition: background 0.15s; }
button:hover { background: #1d4ed8; }`,
    sql: `-- Register event triggers for live browser clicks
CREATE TRIGGER on_increment
ON #increment
AFTER CLICK
AS
BEGIN
  UPDATE #counter
  SET text = CAST(text AS INT) + 1;
  
  UPDATE #status
  SET text = 'Counter incremented via SQL trigger';
END;

CREATE TRIGGER on_decrement
ON #decrement
AFTER CLICK
AS
BEGIN
  UPDATE #counter
  SET text = CAST(text AS INT) - 1;
  
  UPDATE #status
  SET text = 'Counter decremented via SQL trigger';
END;

CREATE TRIGGER on_reset
ON #reset-btn
AFTER CLICK
AS
BEGIN
  UPDATE #counter
  SET text = '0';
  
  UPDATE #status
  SET text = 'Counter reset to 0';
END;`,
  },
  {
    id: "transactions",
    name: "3. Transactions & Atomic Rollback",
    description: "BEGIN TRANSACTION, mutate multiple elements, and ROLLBACK to restore state.",
    html: `<div id="order-card" style="border: 1px solid #cbd5e1; padding: 1.5rem; border-radius: 8px; max-width: 420px; margin: auto; background: #ffffff;">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
    <h3 id="order-title" style="margin: 0; color: #0f172a;">Order #8492</h3>
    <span id="status-badge" style="background: #fef3c7; color: #92400e; padding: 3px 8px; border-radius: 9999px; font-size: 0.85rem; font-weight: 500;">Pending</span>
  </div>
  <p style="color: #475569; margin: 0.5rem 0;">Total Amount: <strong>$149.99</strong></p>
  <button id="checkout-btn" style="background: #10b981; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; font-weight: 500; width: 100%; margin-top: 1rem; cursor: pointer;">Process Payment</button>
  <p id="log-msg" style="color: #64748b; font-size: 0.85rem; margin-top: 0.75rem; text-align: center;">Transaction status: Idle</p>
</div>`,
    css: `body { font-family: system-ui, -apple-system, sans-serif; padding: 1.5rem; background: #f8fafc; }`,
    sql: `-- Begin a transaction, make multiple DOM mutations, then ROLLBACK
BEGIN TRANSACTION;

UPDATE #status-badge
SET text = 'Processing...',
    style.background = '#dbeafe',
    style.color = '#1d4ed8';

UPDATE #checkout-btn
SET disabled = true,
    text = 'Please wait...';

UPDATE #log-msg
SET text = 'Payment failed — rolling back transaction!';

-- Rollback atomically restores every element to its pre-transaction state
ROLLBACK;`,
  },
  {
    id: "css_rules",
    name: "4. CSS.Rules Querying & Live Theming",
    description: "Query and update stylesheet rules using CSS.Rules as a relational data source.",
    html: `<div class="theme-box">
  <h2 class="theme-heading">SQL Theme Engine</h2>
  <p class="theme-text">Stylesheets are relational tables in SQL-DOM. You can SELECT, filter, and UPDATE rule properties directly.</p>
  <div class="theme-badge">Active Stylesheet Rule</div>
</div>`,
    css: `.theme-box { padding: 1.5rem; border: 2px solid #3b82f6; border-radius: 8px; background: #eff6ff; max-width: 480px; margin: auto; }
.theme-heading { color: #1e40af; margin-top: 0; }
.theme-text { color: #3b82f6; font-size: 0.95rem; line-height: 1.5; }
.theme-badge { display: inline-block; background: #3b82f6; color: white; padding: 4px 10px; border-radius: 4px; font-size: 0.85rem; font-weight: 500; }`,
    sql: `-- 1. Query active stylesheet rules
SELECT selector, property, value
FROM CSS.Rules;

-- 2. Modify stylesheet rules relationally
UPDATE CSS.Rules
SET value = '#10b981'
WHERE selector = '.theme-box' AND property = 'border-color';

UPDATE CSS.Rules
SET value = '#ecfdf5'
WHERE selector = '.theme-box' AND property = 'background-color';

UPDATE CSS.Rules
SET value = '#065f46'
WHERE selector = '.theme-heading' AND property = 'color';

UPDATE CSS.Rules
SET value = '#047857'
WHERE selector = '.theme-badge' AND property = 'background-color';`,
  },
  {
    id: "state_tables",
    name: "5. Application State (STATE.Users)",
    description: "Query and update external application state tables through SQL.",
    html: `<div id="user-management" style="max-width: 500px; margin: auto;">
  <h2 style="color: #0f172a; margin-top: 0;">Application State Directory</h2>
  <p style="color: #64748b; font-size: 0.9rem;">State tables provide a unified interface for in-memory JS data.</p>
  <div id="user-list"></div>
</div>`,
    css: `body { font-family: system-ui, -apple-system, sans-serif; padding: 1.5rem; background: #f8fafc; }
.user-card { background: white; border: 1px solid #e2e8f0; padding: 0.75rem 1rem; margin-top: 0.5rem; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; }
.user-name { font-weight: 600; color: #1e293b; }
.user-role { color: #64748b; font-size: 0.85rem; }
.badge-active { background: #dcfce7; color: #15803d; padding: 2px 8px; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }`,
    sql: `-- 1. Query active users from application state
SELECT id, name, role, active
FROM STATE.Users
WHERE active = true;

-- 2. Insert a new record into application state
INSERT INTO STATE.Users (id, name, role, active)
VALUES (4, 'Dana Scully', 'Special Agent', true);

-- 3. Verify all state records
SELECT id, name, role, active
FROM STATE.Users;`,
  },
];

export const DEFAULT_EXAMPLE = EXAMPLES[0]!;
export const DEFAULT_HTML = DEFAULT_EXAMPLE.html;
export const DEFAULT_CSS = DEFAULT_EXAMPLE.css;
export const DEFAULT_SQL = DEFAULT_EXAMPLE.sql;

export interface PlaygroundSource {
  sql: string;
  html: string;
  css: string;
}

export function buildPreviewDocument(html: string, css: string): string {
  const safeCss = css.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${safeCss}</style></head><body>${html}</body></html>`;
}

export function selectedSql(sql: string, start: number | null, end: number | null): string {
  if (start === null || end === null || start === end) return sql;
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const selection = sql.slice(from, to).trim();
  return selection || sql;
}

export function parseProgram(source: string): { program?: Program; diagnostics: string[]; errors?: Diagnostic[] } {
  try {
    const program = new Parser(new Lexer(source).tokenize()).parse();
    return { program, diagnostics: [], errors: [] };
  } catch (error) {
    if (error instanceof ParseError) {
      return {
        diagnostics: error.diagnostics.map((diagnostic) => {
          const location = `${diagnostic.line}:${diagnostic.column}`;
          return `${location} ${diagnostic.message}`;
        }),
        errors: error.diagnostics,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      diagnostics: [message],
      errors: [{ message, line: 1, column: 1, length: 1, severity: "error" }],
    };
  }
}
