# SQL-DOM User Guide & Demo Manual

Welcome to **SQL-DOM**, a domain-specific SQL-inspired language and interactive development environment that treats the browser Document Object Model (DOM), CSS stylesheets, and application state as relational data sources.

---

## Table of Contents

1. [Overview & Core Concept](#1-overview--core-concept)
2. [Quickstart: Launching the Playground](#2-quickstart-launching-the-playground)
3. [Playground Interface Guide](#3-playground-interface-guide)
4. [Relational DOM Model](#4-relational-dom-model)
5. [SQL Syntax Reference & Examples](#5-sql-syntax-reference--examples)
   - [SELECT: Querying DOM Elements](#select-querying-dom-elements)
   - [UPDATE: Modifying Elements & Styles](#update-modifying-elements--styles)
   - [INSERT: Creating DOM Elements](#insert-creating-dom-elements)
   - [DELETE: Removing DOM Elements](#delete-removing-dom-elements)
   - [Transactions: BEGIN, COMMIT & ROLLBACK](#transactions-begin-commit--rollback)
   - [Event Triggers: Live Interactivity](#event-triggers-live-interactivity)
   - [Mutation Triggers: OLD and NEW](#mutation-triggers-old-and-new)
   - [CSS.Rules: Stylesheets as Tables](#cssrules-stylesheets-as-tables)
   - [STATE Tables: Application Data Binding](#state-tables-application-data-binding)
6. [JavaScript Compilation & SDK](#6-javascript-compilation--sdk)
7. [Demo Presets Walkthrough](#7-demo-presets-walkthrough)

---

## 1. Overview & Core Concept

In SQL-DOM:
- **Elements are rows**: Every DOM node corresponds to a record in the `Elements` table.
- **Attributes & properties are columns**: `id`, `tag`, `text`, `class`, `value`, `disabled`, `hidden`, `style`, `dataset`, etc.
- **Selectors are scopes**: You can query the whole document (`FROM Elements`) or target specific subtrees (`FROM #container`, `FROM .card`).
- **Stylesheets and State are tables**: `CSS.Rules` allows querying and updating CSS rules relationally; `STATE.<table>` binds in-memory JavaScript objects.

The language is powered by a TypeScript AST pipeline with dual execution targets:
1. **Interpreter**: Directly evaluates queries and applies mutations against any live DOM `Document` or `Element`.
2. **Compiler**: Compiles SQL into pure JavaScript closures sharing identical SQL coercion semantics.

---

## 2. Quickstart: Launching the Playground

To start the interactive browser playground:

```bash
# 1. Install dependencies (if not already installed)
npm install

# 2. Start the development server
npm start
```

Open your browser to:
```
http://localhost:5173
```

---

## 3. Playground Interface Guide

The SQL-DOM playground is designed in the style of a database IDE (such as SQL Server Management Studio):

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ [▶ Run (Ctrl+Enter)] [Run Selected] [↺ Reset Preview]  Preset: [CRUD ▼]  │
├──────────────────────────┬──────────────────────┬────────────────────────┤
│ SQL Query Editor         │ Initial HTML         │ Initial CSS            │
│ (Monaco Editor)          │ (Monaco Editor)      │ (Monaco Editor)        │
├──────────────────────────┴──────────────────────┴────────────────────────┤
│ Object Explorer (DOM)    │ Live Browser Preview (Sandboxed iframe)       │
├──────────────┬───────────┴───┬──────────────────┬────────────────────────┤
│ Results Grid │ Messages      │ AST Inspector    │ Generated JS │ Events  │
└──────────────┴───────────────┴──────────────────┴──────────────┴─────────┘
```

### Key UI Features:
- **Preset Example Dropdown**: Switch between 5 pre-built demo scenarios (CRUD, Event Triggers, Transactions, CSS Theming, State Tables).
- **Run (Ctrl+Enter / Cmd+Enter)**: Parses and executes the entire SQL query against the preview iframe.
- **Run Selected**: Executes only the highlighted SQL snippet.
- **Reset Preview**: Reconstructs the sandboxed preview document from the HTML and CSS editors.
- **Object Explorer**: Shows the real-time DOM tree hierarchy. **Click any node** to inspect its full relational row in the Results Grid and highlight it with a glowing border in the preview.
- **Results Grid**: Displays tabular data returned by `SELECT` queries.
- **Messages**: Displays affected row counts, execution duration in milliseconds, and detailed error messages.
- **AST Inspector**: Real-time JSON visualization of the parsed Abstract Syntax Tree.
- **Generated JavaScript**: Real-time compiled JavaScript output corresponding to the SQL AST.
- **Event / Trigger Log**: Real-time audit log of fired browser event triggers.

---

## 4. Relational DOM Model

The `Elements` table exposes the following built-in columns:

| Column | Type | Description | Corresponding DOM Property |
|--------|------|-------------|----------------------------|
| `id` | `STRING` | Element ID attribute | `element.id` |
| `tag` | `STRING` | HTML Tag name (e.g. `BUTTON`, `DIV`) | `element.tagName` |
| `text` | `STRING` | Text content | `element.textContent` |
| `html` | `STRING` | Inner HTML | `element.innerHTML` |
| `class` | `STRING` | CSS class name | `element.className` |
| `value` | `ANY` | Form control value | `element.value` |
| `name` | `STRING` | Name attribute | `element.getAttribute("name")` |
| `type` | `STRING` | Input type attribute | `element.getAttribute("type")` |
| `hidden` | `BOOLEAN` | Hidden state | `element.hidden` |
| `disabled` | `BOOLEAN` | Disabled state | `element.disabled` |
| `checked` | `BOOLEAN` | Checked state | `element.checked` |
| `parentId` | `STRING` | Parent element ID | `element.parentElement.id` |
| `style.<prop>` | `STRING` | Inline style property | `element.style.<prop>` |
| `computedStyle.<prop>` | `STRING` | Computed CSS property | `getComputedStyle(element).<prop>` |
| `dataset.<prop>` | `STRING` | Data attribute | `element.dataset.<prop>` |
| `attributes.<name>` | `STRING` | Raw attribute value | `element.getAttribute(<name>)` |

---

## 5. SQL Syntax Reference & Examples

### SELECT: Querying DOM Elements

#### Global Queries
```sql
-- Select all buttons and inputs
SELECT id, tag, text, disabled
FROM Elements
WHERE tag = 'button' OR tag = 'input';
```

#### Expression Projections & CAST
```sql
-- Cast text to integer and increment
SELECT id, text, CAST(text AS INT) + 10 AS next_value
FROM Elements
WHERE id = 'counter';
```

#### Computed Style & Dataset Queries
```sql
-- Query computed styles and data attributes
SELECT id, dataset.userId, computedStyle.color, computedStyle.display
FROM Elements
WHERE computedStyle.display != 'none';
```

#### Scoped Tree Queries
```sql
-- Query descendants of an element by ID
SELECT id, tag, text
FROM #todoList
WHERE class LIKE '%item%';

-- Query direct children
SELECT id, tag
FROM CHILDREN(#app);

-- Query parent of an element
SELECT id, tag
FROM PARENT OF #submitBtn;
```

---

### UPDATE: Modifying Elements & Styles

#### Updating Text and Classes
```sql
UPDATE Elements
SET text = 'Welcome to SQL-DOM!',
    class = 'title active'
WHERE id = 'welcomeHeading';
```

#### Updating Inline Styles
```sql
UPDATE Elements
SET style.color = '#2563eb',
    style.fontSize = '18px',
    style.backgroundColor = '#eff6ff'
WHERE class LIKE '%card%';
```

#### Controlling Form State
```sql
UPDATE Elements
SET disabled = false,
    checked = true,
    value = 'Admin User'
WHERE id = 'roleInput';
```

---

### INSERT: Creating DOM Elements

#### Standard INSERT into Container
```sql
INSERT INTO #items (tag, class, text)
VALUES
  ('p', 'item-card', 'First item created with SQL'),
  ('p', 'item-card', 'Second item created with SQL');
```

#### INSERT with RETURNING
```sql
INSERT INTO #app (tag, class, text)
VALUES ('div', 'alert', 'Action completed!')
RETURNING id, tag, text;
```

---

### DELETE: Removing DOM Elements

```sql
-- Remove elements by ID
DELETE FROM Elements
WHERE id = 'tempNotification';

-- Remove elements matching a class pattern
DELETE FROM Elements
WHERE class LIKE '%expired%';
```

---

### Transactions: BEGIN, COMMIT & ROLLBACK

Transactions execute synchronously and record all DOM modifications. If `ROLLBACK` is issued, the runtime applies reverse mutations to restore the exact pre-transaction DOM state.

```sql
BEGIN TRANSACTION;

UPDATE #status-badge
SET text = 'Processing...',
    style.color = '#2563eb';

UPDATE #checkout-button
SET disabled = true,
    text = 'Please wait...';

-- An unexpected error occurs: Rollback atomically restores all elements!
ROLLBACK;
```

---

### Event Triggers: Live Interactivity

You can define declarative event triggers that attach event listeners to the DOM and execute SQL statements whenever browser events occur.

Supported events: `CLICK`, `CHANGE`, `INPUT`, `SUBMIT`, `FOCUS`, `BLUR`, `KEYDOWN`, `KEYUP`.

```sql
-- Counter increment trigger
CREATE TRIGGER on_increment
ON #incrementBtn
AFTER CLICK
AS
BEGIN
  UPDATE #counterDisplay
  SET text = CAST(text AS INT) + 1;
  
  UPDATE #statusLog
  SET text = 'Incremented via SQL trigger';
END;
```

---

### Mutation Triggers: OLD and NEW

Mutation triggers fire when an `UPDATE` statement modifies a specific element or property. `OLD` and `NEW` pseudo-records provide access to pre- and post-mutation values.

```sql
CREATE TRIGGER on_user_change
ON #usernameInput
AFTER UPDATE OF value
AS
BEGIN
  UPDATE #usernameFeedback
  SET text = CASE
    WHEN LEN(NEW.value) < 3 THEN 'Username is too short'
    ELSE 'Valid username'
  END;
END;
```

---

### CSS.Rules: Stylesheets as Tables

The `CSS.Rules` table allows querying and modifying CSS rules in stylesheets dynamically.

Columns: `selector`, `property`, `value`, `important`.

```sql
-- 1. Inspect all CSS stylesheet rules
SELECT selector, property, value
FROM CSS.Rules;

-- 2. Update styles across the entire page via CSS rules
UPDATE CSS.Rules
SET value = '#10b981'
WHERE selector = '.theme-card' AND property = 'border-color';

UPDATE CSS.Rules
SET value = '#ecfdf5'
WHERE selector = '.theme-card' AND property = 'background-color';
```

---

### STATE Tables: Application Data Binding

The `STATE.<table>` namespace allows querying and mutating in-memory JavaScript datasets registered with the runtime.

```sql
-- 1. Query active users from registered application state
SELECT id, name, role, active
FROM STATE.Users
WHERE active = true;

-- 2. Insert new record into application state
INSERT INTO STATE.Users (id, name, role, active)
VALUES (5, 'Dana Scully', 'Special Agent', true);

-- 3. Delete records from state
DELETE FROM STATE.Users
WHERE id = 3;
```

---

## 6. JavaScript Compilation & SDK

SQL-DOM statements can be compiled to JavaScript or executed programmatically:

### Compiling to JavaScript
```typescript
import { compile } from "@domsql/compiler";

const jsCode = compile(`
  UPDATE Elements
  SET text = 'Saved'
  WHERE id = 'saveBtn';
`);

console.log(jsCode);
```

### Executing via Runtime SDK
```typescript
import { execute } from "@domsql/runtime";

const result = execute(`
  SELECT id, tag, text
  FROM Elements
  WHERE class LIKE '%card%';
`, {
  root: document,
  params: { status: "active" }
});

console.log(result.rows);
console.log(result.messages);
```

---

## 7. Demo Presets Walkthrough

The playground includes 5 built-in presets in the toolbar:

1. **1. DOM Elements & CRUD**: Demonstrates querying DOM nodes, updating text and styling, inserting new paragraph elements, and deleting elements.
2. **2. Event Triggers & Counter**: Demonstrates interactive live counters using `CREATE TRIGGER ... AFTER CLICK`.
3. **3. Transactions & Atomic Rollback**: Demonstrates making multiple DOM mutations and restoring the exact original DOM state using `ROLLBACK`.
4. **4. CSS.Rules Theming**: Demonstrates relational stylesheet manipulation on `CSS.Rules`.
5. **5. Application State (STATE.Users)**: Demonstrates relational querying, inserting, and deleting on in-memory JavaScript data structures.

Enjoy exploring SQL-DOM!
