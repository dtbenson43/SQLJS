# SQL-to-DOM Language and Browser Playground Implementation Plan

## 1. Goal

Build a small SQL-inspired programming language for controlling HTML, CSS, and eventually JavaScript application state.

The initial language will treat the browser DOM as a mutable relational data source. Elements become rows, element properties and attributes become columns, and SQL statements operate over sets of elements.

The project will have two independent pieces:

**Core language/runtime:** parses SQL, executes it against a DOM, and can compile the same program into JavaScript.

**Browser playground:** a small SSMS-style development environment containing a query editor, DOM explorer, rendered HTML preview, results table, messages, trigger/event log, and generated JavaScript view.

The first version should be intentionally small. The objective is not SQL compatibility. It is to determine whether SQL semantics make DOM programming interesting and useful.

---

# 2. Core Architectural Principle

The language pipeline should be:

```text
SQL source
    ↓
Lexer
    ↓
Parser
    ↓
AST
    ↓
Semantic validation
    ↓
Execution Engine
   ↙ ↘
DOM   JavaScript Compiler
```

The AST is the contract between every part of the system.

The interpreter and compiler should never parse SQL independently.

For example:

```sql
UPDATE Elements
SET text = 'Saving...',
    disabled = true
WHERE id = 'saveButton';
```

might produce an AST conceptually resembling:

```ts
{
  type: "update",
  source: {
    type: "global"
  },
  assignments: [
    {
      property: ["text"],
      value: { type: "literal", value: "Saving..." }
    },
    {
      property: ["disabled"],
      value: { type: "literal", value: true }
    }
  ],
  where: {
    type: "binary",
    operator: "=",
    left: { type: "column", name: "id" },
    right: { type: "literal", value: "saveButton" }
  }
}
```

The interpreter executes that AST directly.

The compiler translates the same AST into JavaScript.

This keeps language semantics independent from both the playground and generated code.

---

# 3. Repository Structure

Use a small TypeScript monorepo:

```text
/sql-dom
    /packages

        /language
            lexer.ts
            parser.ts
            ast.ts
            errors.ts
            formatter.ts

        /runtime
            execute.ts
            query.ts
            mutation.ts
            transaction.ts
            triggers.ts
            values.ts
            element-row.ts

        /compiler
            compile.ts
            expressions.ts
            statements.ts

        /playground
            editor/
            preview/
            results/
            explorer/
            messages/
            examples/

        /tests
            parser/
            runtime/
            compiler/
            browser/
```

`language` should know nothing about the browser.

`runtime` understands DOM objects.

`compiler` converts AST nodes into JavaScript.

`playground` consumes all three packages but contains no language semantics itself.

That distinction will become very valuable once the language starts acquiring increasingly questionable features.

---

# 4. DOM Relational Model

The runtime exposes a conceptual built-in table called:

```sql
Elements
```

Every DOM element becomes one row.

A basic row should expose:

```text
element
id
tag
text
html
class
value
name
type
hidden
disabled
checked
parent
parentId
attributes
dataset
style
```

`element` is the underlying `HTMLElement` reference and normally does not need to appear in the visual results grid.

The runtime adapter maps SQL properties onto actual DOM operations.

For example:

```text
text       ↔ element.textContent
html       ↔ element.innerHTML
class      ↔ element.className
value      ↔ element.value
hidden     ↔ element.hidden
disabled   ↔ element.disabled
checked    ↔ element.checked
```

Nested properties can represent CSS, attributes, and dataset values:

```sql
UPDATE Elements
SET style.color = 'red'
WHERE class LIKE '%error%';
```

Later:

```sql
UPDATE Elements
SET attributes.ariaLabel = 'Close'
WHERE id = 'closeButton';
```

The runtime should contain the property mapping. The parser should not care what `style.color` means.

---

# 5. Query Scope

Version 0.1 should support two primary scopes.

Global:

```sql
SELECT *
FROM Elements
WHERE tag = 'button';
```

Scoped:

```sql
SELECT *
FROM #settings
WHERE tag = 'input';
```

`FROM #settings` means:

> Query descendants of the element whose ID is `settings`.

This provides the syntax originally envisioned without forcing developers to repeatedly write parent relationships.

Later, more explicit tree operations can be introduced:

```sql
SELECT *
FROM CHILDREN(#settings);
```

```sql
SELECT *
FROM DESCENDANTS(#settings);
```

```sql
SELECT PARENT OF #username;
```

The language should acknowledge that the DOM is a tree instead of desperately pretending it is a normal relational database.

---

# 6. Phase One: Parser and AST

Implement the lexer and parser first.

The initial grammar only needs:

```text
SELECT
FROM
WHERE

UPDATE
SET

INSERT INTO
VALUES

DELETE FROM

AND
OR
NOT

=
!=
>
>=
<
<=
LIKE

NULL
TRUE
FALSE

strings
numbers
identifiers
property paths
element identifiers such as #app
```

The first parser milestone should successfully parse:

```sql
SELECT *
FROM Elements;
```

then:

```sql
SELECT id, text
FROM Elements
WHERE tag = 'button';
```

then:

```sql
UPDATE Elements
SET text = 'Hello'
WHERE id = 'message';
```

Every successful parse returns an AST.

Every failed parse returns structured diagnostics containing:

```text
message
line
column
length
expected tokens
```

Those diagnostics will later feed directly into Monaco squiggles.

---

# 7. Phase Two: Read-Only SELECT Runtime

The first executable feature should be `SELECT`.

Define:

```ts
execute(
  source: string,
  context: ExecutionContext
): QueryResult
```

with a result resembling:

```ts
interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  affectedRows?: number;
  messages: RuntimeMessage[];
  durationMs: number;
}
```

Initially:

```sql
SELECT *
FROM Elements;
```

can simply walk:

```js
document.querySelectorAll("*")
```

and adapt each `HTMLElement` into an element row.

Filtering should execute through the AST rather than compiling expressions into strings.

For:

```sql
WHERE tag = 'button'
  AND disabled = false
```

the runtime evaluates the expression for each candidate element.

Version 0.1 should favor correctness over clever query optimization.

Optimization can come much later.

---

# 8. Expression Engine

Build a reusable expression evaluator because almost everything will eventually depend on it.

It should support:

```sql
tag = 'button'

value > 10

class LIKE '%selected%'

disabled = false

text IS NULL

value + 1

CAST(value AS INT)
```

Expressions should use SQL-like coercion rules defined by this language rather than blindly inheriting JavaScript's impressive collection of coercion accidents.

Function support can begin with:

```text
LEN()
LOWER()
UPPER()
CAST()
COALESCE()
```

Later:

```text
COUNT()
SUM()
AVG()
MIN()
MAX()
```

---

# 9. Phase Three: UPDATE

Once `SELECT` works reliably, implement `UPDATE`.

Example:

```sql
UPDATE Elements
SET text = 'Hello'
WHERE id = 'message';
```

The query portion first resolves the target set.

The mutation layer then performs assignments against each matched element.

This separation is important:

```text
query target elements
        ↓
create mutation operations
        ↓
execute mutations
```

Represent mutations internally:

```ts
interface Mutation {
  element: HTMLElement;
  property: PropertyPath;
  oldValue: unknown;
  newValue: unknown;
}
```

That mutation object will become the foundation for transactions, triggers, debugging, history, and potentially undo/redo.

The runtime result should report:

```text
(3 elements affected)
```

because if we are copying SSMS, we should steal the satisfying parts too.

---

# 10. Phase Four: INSERT and DELETE

Support:

```sql
INSERT INTO #todoList
    (tag, class, text)
VALUES
    ('li', 'todo-item', 'Buy milk');
```

The runtime will:

```text
resolve #todoList
create element using tag
assign requested properties
append element
record mutation
```

Support:

```sql
DELETE FROM Elements
WHERE class LIKE '%expired%';
```

which removes all matched elements.

Add `RETURNING` shortly afterward:

```sql
INSERT INTO #todoList
    (tag, class, text)
VALUES
    ('li', 'todo-item', 'Buy milk')
RETURNING element;
```

This establishes a way to obtain references to newly created elements without introducing JavaScript prematurely.

---

# 11. Phase Five: Build the Playground

At this point the language is already interesting enough to deserve the browser environment.

The interface should deliberately resemble a tiny database IDE.

A desktop layout could look like:

```text
┌───────────────────────────────────────────────────────────────┐
│ Run │ Run Selected │ Reset │ Examples                        │
├───────────────┬─────────────────────────┬─────────────────────┤
│               │                         │                     │
│ Object        │ SQL Editor              │ Browser Preview     │
│ Explorer      │                         │                     │
│               │                         │                     │
│ Elements      │                         │                     │
│ Triggers      │                         │                     │
│               │                         │                     │
├───────────────┴─────────────────────────┴─────────────────────┤
│ Results │ Messages │ Generated JS │ AST │ Events             │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

The preview should run inside a sandboxed iframe.

The iframe contains the document being manipulated.

SQL executes against:

```ts
iframe.contentDocument
```

rather than against the playground itself.

That isolation is essential.

Otherwise:

```sql
DELETE FROM Elements;
```

would delete your SQL editor.

Which would admittedly be extremely funny exactly once.

---

# 12. Playground HTML and CSS Editing

The playground should contain three source tabs:

```text
SQL
HTML
CSS
```

HTML defines the initial document.

CSS defines its initial styling.

SQL manipulates the resulting document.

For example, the default example could contain:

```html
<button class="counter">0</button>
<button id="increment">Increment</button>
```

and:

```sql
UPDATE .counter
SET text = CAST(text AS INT) + 1;
```

Changing HTML or CSS rebuilds the preview.

Running SQL modifies the current preview without rebuilding it.

`Reset` reconstructs the iframe from the original HTML and CSS.

This makes experimentation extremely fast.

---

# 13. Object Explorer

The left-side Object Explorer should initially expose:

```text
DOM
    html
        head
        body
            #app
                button.counter
                #increment

Triggers

Variables
```

Selecting an element displays its relational representation:

```text
id          increment
tag         BUTTON
text        Increment
class
disabled    false
hidden      false
parentId    app
```

Eventually the explorer can allow generating queries.

For example, right-clicking an element could create:

```sql
SELECT *
FROM Elements
WHERE id = 'increment';
```

That is thoroughly unnecessary and therefore mandatory for the full tiny-SSMS experience.

---

# 14. Results Grid

`SELECT` statements populate a proper tabular result area.

For:

```sql
SELECT id, tag, text
FROM Elements
WHERE tag = 'button';
```

display:

| id        | tag    | text      |
| --------- | ------ | --------- |
| increment | BUTTON | Increment |
| cancel    | BUTTON | Cancel    |

Multiple SELECT statements should eventually create multiple result sets just like database tools do.

Mutation statements instead populate Messages:

```text
Query executed successfully.

(4 elements affected)

Execution time: 1.7 ms
```

---

# 15. AST Inspector

Include an `AST` result tab early.

Executing:

```sql
SELECT *
FROM Elements
WHERE tag = 'button';
```

can expose its parsed representation.

This will be invaluable while developing the language because every parser bug becomes immediately inspectable.

It also makes the playground useful as the language's own development environment.

---

# 16. Phase Six: Transactions

Transactions should initially be synchronous.

Support:

```sql
BEGIN TRANSACTION;

UPDATE #spinner
SET hidden = false;

UPDATE #saveButton
SET disabled = true;

COMMIT;
```

The runtime already records mutations:

```text
element
property
oldValue
newValue
```

During a transaction, retain these records.

On:

```sql
ROLLBACK;
```

apply the mutations backward:

```text
mutation N
mutation N - 1
mutation N - 2
...
```

restoring each old value.

A version 0.1 transaction should explicitly prohibit asynchronous execution.

That means no network request, timer, promise, or `await` inside a transaction.

This gives the language predictable semantics and makes rollback practical.

Later, transactions could use a full shadow DOM/state overlay, but that is unnecessary until the language proves it deserves such extravagant treatment.

---

# 17. Phase Seven: Triggers

Triggers should be divided into two classes.

## Event Triggers

Browser events become trigger events:

```sql
CREATE TRIGGER increment_counter
ON #increment
AFTER CLICK
AS
BEGIN
    UPDATE #counter
    SET text = CAST(text AS INT) + 1;
END;
```

Other events can follow naturally:

```text
CLICK
CHANGE
INPUT
SUBMIT
FOCUS
BLUR
KEYDOWN
KEYUP
```

Implement these using delegated event handlers attached to the iframe document.

That means a trigger defined against:

```sql
ON .todo-delete
```

will also work for `.todo-delete` elements inserted later.

## Mutation Triggers

The runtime's own mutation system can generate database-like triggers:

```sql
CREATE TRIGGER validate_username
ON #username
AFTER UPDATE OF value
AS
BEGIN
    UPDATE #usernameStatus
    SET text =
        CASE
            WHEN LEN(NEW.value) < 3 THEN 'Too short'
            ELSE 'Valid'
        END;
END;
```

Expose:

```text
OLD
NEW
```

inside mutation triggers.

Initially, mutation triggers should fire only for changes made through this language.

Do not use `MutationObserver` to capture arbitrary external JavaScript changes yet.

That can become an explicit later feature.

---

# 18. Trigger Safety

Triggers immediately create the possibility of:

```text
Trigger A updates X
X fires Trigger B
Trigger B updates Y
Y fires Trigger A
...
```

The runtime therefore needs a trigger execution stack.

Keep:

```ts
triggerStack: TriggerId[]
```

and a configurable maximum trigger depth.

If recursion exceeds the limit:

```text
Trigger execution aborted:
maximum trigger depth exceeded.

A → B → A → B → A
```

The Events tab should display this chain.

This turns an otherwise baffling bug into something understandable.

---

# 19. Phase Eight: JavaScript Compiler

Only after the interpreter works should compilation begin.

The first compiler should generate JavaScript that calls the language runtime.

For example:

```sql
UPDATE Elements
SET text = 'Saving...'
WHERE id = 'saveButton';
```

could compile to something conceptually similar to:

```js
domsql.update({
    source: domsql.elements(document),

    where: row =>
        row.id === "saveButton",

    set: {
        text: "Saving..."
    }
});
```

This is much easier and safer than attempting to immediately generate highly optimized standalone DOM code.

The playground's `Generated JS` tab can show this output automatically.

Later compiler optimization can transform obvious operations into native DOM calls.

For example:

```sql
UPDATE Elements
SET disabled = true
WHERE id = 'saveButton';
```

could eventually become:

```js
document.getElementById("saveButton").disabled = true;
```

That optimization should come later.

Correct semantics are more important than clever code generation.

---

# 20. Interpreter/Compiler Differential Testing

The interpreter and generated JavaScript should be tested against one another.

Given identical starting HTML:

```text
Run SQL through interpreter
        ↓
capture DOM

Reset

Compile SQL to JavaScript
        ↓
run JavaScript
        ↓
capture DOM
```

Then compare the two resulting DOM trees.

They should be identical.

This creates a powerful correctness test for the compiler.

As the language grows, every test program can verify both execution strategies simultaneously.

---

# 21. Phase Nine: Parameters and JS Interop

Before arbitrary JavaScript integration, add parameters.

JavaScript:

```ts
execute(sql, {
  params: {
    username: "Daniel"
  }
});
```

SQL:

```sql
UPDATE #username
SET text = $username;
```

This allows application code to safely provide external state without injecting JavaScript expressions into SQL.

Then expose programmatic usage:

```ts
import { execute } from "@domsql/runtime";

execute(`
    UPDATE #status
    SET text = $status
`, {
    root: document,
    params: {
        status: "Complete"
    }
});
```

At this stage the project becomes usable outside the playground.

---

# 22. Phase Ten: CSS as a Queryable Data Source

Once DOM operations work, introduce CSS.

Expose:

```sql
Styles
```

or:

```sql
CSS.Rules
```

Example:

```sql
SELECT *
FROM CSS.Rules
WHERE selector = '.error';
```

Then:

```sql
UPDATE CSS.Rules
SET value = 'red'
WHERE selector = '.error'
  AND property = 'color';
```

Another possibility is querying computed style through elements:

```sql
SELECT id, style.color
FROM Elements
WHERE style.display != 'none';
```

The first CSS implementation should remain separate from the DOM table internally even if the language makes them feel integrated.

---

# 23. Phase Eleven: Application State

Application state is the point where this can grow beyond DOM manipulation.

Expose a runtime-managed state namespace:

```sql
STATE
```

Application code might register:

```ts
runtime.registerTable("Users", users);
```

and SQL could then execute:

```sql
SELECT *
FROM STATE.Users
WHERE active = true;
```

Eventually:

```sql
UPDATE Elements
SET hidden = true
WHERE dataset.userId IN (
    SELECT id
    FROM STATE.Users
    WHERE banned = true
);
```

Now DOM state and application state can participate in the same declarative operation.

That begins to turn the project into a genuine UI programming model rather than merely strange syntax.

---

# 24. Features Explicitly Deferred

The first release should not attempt full SQL compatibility.

Defer:

```text
JOIN
GROUP BY
HAVING
CTEs
recursive CTEs
window functions
stored procedures
async transactions
arbitrary JavaScript expressions
network access
MutationObserver integration
query optimizer
indexes
full T-SQL compatibility
```

These become interesting only after the underlying programming model proves enjoyable.

`JOIN`, aggregates, and CTEs would be the next major SQL expansion.

---

# 25. Testing Strategy

Parser tests should verify SQL-to-AST output.

Semantic tests should verify errors such as:

```sql
UPDATE Elements
SET completelyFakeProperty = 123;
```

Runtime tests should start from known HTML and verify resulting query data or DOM mutations.

Transaction tests should verify that rollback exactly restores the original DOM.

Trigger tests should verify trigger ordering, `OLD`/`NEW`, recursion protection, and event delegation.

Compiler tests should snapshot generated JavaScript.

Differential tests should verify that interpreted SQL and compiled JavaScript produce identical results.

Browser tests should execute programs against an actual DOM implementation to catch behavior that unit mocks miss.

---

# 26. First Complete Vertical Slice

Before adding transactions, triggers, CSS, or JavaScript compilation, build one tiny end-to-end playground capable of running:

```html
<div id="app">
    <h1 class="title">Hello</h1>
    <button id="change">Change Me</button>
</div>
```

against:

```sql
SELECT id, tag, text
FROM Elements;
```

then:

```sql
UPDATE Elements
SET text = 'Goodbye'
WHERE class LIKE '%title%';
```

then:

```sql
INSERT INTO #app
    (tag, class, text)
VALUES
    ('p', 'message', 'Created from SQL');
```

then:

```sql
DELETE FROM Elements
WHERE id = 'change';
```

The preview should visibly change.

SELECT should populate the results grid.

Mutations should report affected rows.

Reset should restore the original page.

That is the first meaningful release.

---

# 27. Version 0.1 Definition of Done

Version 0.1 should have the following language surface:

```sql
SELECT
INSERT
UPDATE
DELETE

FROM Elements
FROM #element

WHERE

AND
OR
NOT

=
!=
<
<=
>
>=
LIKE

BEGIN TRANSACTION
COMMIT
ROLLBACK

CREATE TRIGGER
AFTER CLICK
AFTER CHANGE
AFTER INPUT
AFTER UPDATE

OLD
NEW

RETURNING
```

The playground should contain:

```text
SQL editor
HTML editor
CSS editor
Run
Run Selected
Reset
DOM preview
Object Explorer
Results
Messages
AST
Generated JavaScript
Event/Trigger Log
```

At that point there is enough surface area to determine what the language actually wants to become.

---

# 28. Recommended Development Order

The dependency chain should be:

```text
AST types
   ↓
Lexer + parser
   ↓
Expression evaluator
   ↓
Element row adapter
   ↓
SELECT
   ↓
UPDATE
   ↓
INSERT / DELETE
   ↓
Basic playground
   ↓
Transactions
   ↓
Triggers
   ↓
JavaScript compiler
   ↓
Parameters / external API
   ↓
CSS tables
   ↓
STATE tables
   ↓
Advanced SQL
```

The playground intentionally appears fairly early.

Once `SELECT`, `UPDATE`, `INSERT`, and `DELETE` work, development should happen primarily through the playground. It becomes both the demo and the development environment for the language itself.

---

# 29. Longer-Term Direction

If the experiment works, the architecture can eventually support code like:

```sql
CREATE TRIGGER update_cart
ON .quantity
AFTER CHANGE
AS
BEGIN
    UPDATE #cartTotal
    SET text = (
        SELECT SUM(
            CAST(value AS DECIMAL) *
            CAST(dataset.price AS DECIMAL)
        )
        FROM .quantity
    );
END;
```

or:

```sql
BEGIN TRANSACTION;

UPDATE Elements
SET hidden = true
WHERE class LIKE '%loading-hidden%';

UPDATE #loading
SET hidden = false;

COMMIT;
```

and eventually:

```sql
UPDATE DOM.Elements
SET hidden = true
WHERE dataset.userId IN (
    SELECT id
    FROM STATE.Users
    WHERE permissions NOT LIKE '%admin%'
);
```

The important design constraint is that SQL should remain declarative.

The language should describe:

> which objects match, and what should become true about them

rather than simply disguising imperative JavaScript statements with SQL keywords.

That distinction is what gives the experiment the chance to become an interesting programming model instead of merely JavaScript wearing an SQL costume.
