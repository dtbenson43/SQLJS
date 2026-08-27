# Implementation Progress

> Tracking against [implementation-plan.md](./implementation-plan.md) §28 Recommended Development Order.

## Status Legend

- ⬜ Pending
- 🟡 In Progress
- 🟢 Complete
- 🔴 Blocked

---

## Phase 1: AST Types

| Step | Status | Notes |
|------|--------|-------|
| AST node type definitions | 🟢 | |
| AST visitor/util types | ⬜ | |

## Phase 2: Lexer

| Step | Status | Notes |
|------|--------|-------|
| Token type definitions | 🟢 | |
| Lexer implementation | 🟢 | |
| Lexer tests | 🟢 | 11 tests passing |

## Phase 3: Parser

| Step | Status | Notes |
|------|--------|-------|
| SELECT parsing | 🟢 | |
| INSERT parsing | 🟢 | |
| UPDATE parsing | 🟢 | |
| DELETE parsing | 🟢 | |
| WHERE clause parsing | 🟢 | |
| Expression parsing | 🟢 | |
| Structured diagnostics | 🟢 | |
| Parser tests | 🟢 | 19 parser tests + 3 round-trip tests passing |

## Phase 4: Expression Evaluator

| Step | Status | Notes |
|------|--------|-------|
| Expression evaluator | 🟢 | AST-driven evaluator with row, OLD/NEW, and parameter contexts |
| SQL coercion rules | 🟢 | Three-valued logic, NULL propagation, numeric coercion, and LIKE |
| Built-in functions | 🟢 | LEN, LOWER, UPPER, COALESCE, CAST |
| Expression tests | 🟢 | 6 evaluator tests passing |

## Phase 5: Element Row Adapter

| Step | Status | Notes |
|------|--------|-------|
| Element row mapping | 🟢 | Maps element, identity, content, form state, tree, attributes, dataset, and style |
| Property adapter | 🟢 | Reads/writes mapped properties and nested style/attribute/dataset paths |
| Scope resolution (#id) | 🟢 | Resolves global, scoped, descendants, children, and parent sources |

## Phase 6: SELECT Runtime

| Step | Status | Notes |
|------|--------|-------|
| execute() entry point | 🟢 | |
| SELECT execution | 🟢 | |
| WHERE filtering | 🟢 | |
| SELECT tests | 🟢 | 13 runtime tests passing |

## Phase 7: UPDATE Runtime

| Step | Status | Notes |
|------|--------|-------|
| UPDATE execution | 🟢 | |
| Mutation recording | 🟢 | |
| UPDATE tests | 🟢 | Part of 13 runtime tests |

## Phase 8: INSERT / DELETE Runtime

| Step | Status | Notes |
|------|--------|-------|
| INSERT execution | 🟢 | |
| DELETE execution | 🟢 | |
| RETURNING clause | 🟢 | |
| INSERT/DELETE tests | 🟢 | Part of 13 runtime tests |

## Phase 9: Basic Playground

| Step | Status | Notes |
|------|--------|-------|
| Playground scaffolding | 🟢 | `PlaygroundController` mounts the SSMS-style layout |
| SQL editor (Monaco) | 🟢 | Lazy-loaded Monaco editor with SQL tokens, completion, and parse markers |
| HTML/CSS editors | 🟢 | Source textareas feed preview rebuilds |
| Sandboxed iframe preview | 🟢 | `srcdoc` preview uses `sandbox="allow-same-origin"` |
| Results grid | 🟢 | Tabular SELECT output with safe text rendering |
| Messages panel | 🟢 | Runtime messages and execution status |
| AST inspector | 🟢 | Parsed program shown as formatted JSON |
| Object explorer | 🟢 | Recursive preview DOM tree |
| Run / Run Selected / Reset | 🟢 | Controls wired to runtime and preview lifecycle |

## Phase 10: Transactions

| Step | Status | Notes |
|------|--------|-------|
| BEGIN/COMMIT/ROLLBACK | 🟢 | |
| Mutation journal | 🟢 | |
| Transaction tests | 🟢 | Part of 13 runtime tests |

## Phase 11: Triggers

| Step | Status | Notes |
|------|--------|-------|
| Event triggers (CLICK, etc.) | 🟢 | Delegated iframe-document listeners dispatch persistent event triggers |
| Mutation triggers (AFTER UPDATE) | 🟢 | Fire on matching element+property |
| OLD/NEW context | 🟢 | Available in trigger execution |
| Recursion protection | 🟢 | MAX_TRIGGER_DEPTH = 32 |
| Trigger tests | 🟢 | Mutation trigger tests passing |

## Phase 12: JavaScript Compiler

| Step | Status | Notes |
|------|--------|-------|
| AST-to-JS compilation | 🟢 | Expression compiler emits JS closures; statements compile to runtime boundary calls |
| Generated JS view | 🟢 | Playground displays generated function after successful parse |
| Compiler tests | 🟢 | Compiler output and execution coverage added |
| Differential tests | 🟢 | Interpreter vs compiled DOM snapshots + result rows compared (14 differential/expression tests) |

## Phase 13: Parameters / External API

| Step | Status | Notes |
|------|--------|-------|
| $param support | 🟢 | Supported in evaluator and execution context |
| execute() public API | 🟢 | Exported from runtime package |
| API tests | 🟢 | End-to-end tests passing |

## Phase 14: CSS Tables

| Step | Status | Notes |
|------|--------|-------|
| CSS.Rules table | 🟢 | Reads stylesheet declarations and supports SELECT/UPDATE of selector, property, value, and important |
| Computed style queries | 🟢 | `computedStyle.<property>` is exposed on element rows |

## Phase 15: STATE Tables

| Step | Status | Notes |
|------|--------|-------|
| STATE namespace | 🟢 | SELECT/UPDATE/INSERT/DELETE support for STATE.<table> rows |
| registerTable() API | 🟢 | Runtime registry plus per-execution table overrides |

## Phase 16: Advanced SQL

| Step | Status | Notes |
|------|--------|-------|
| JOIN | ⬜ | |
| GROUP BY / aggregates | ⬜ | |
| CTEs | ⬜ | |
| Subqueries | ⬜ | |

---

## Current Focus

> **Browser integration and polish complete** — the Vite entry point, Monaco editors, delegated event triggers, computed styles, and state-table mutation operations are implemented. Advanced SQL remains intentionally deferred.

## Commit Log

| Date | Summary |
|------|---------|
| 2026-08-26 | Project init — PROGRESS.md created, beginning AST types |
| 2026-08-26 | Phase 1-2 complete: AST types, tokens, lexer, parser, formatter. 26 smoke tests passing. |
| 2026-08-26 | Review pass: fixed 9 bugs in parser/formatter/lexer. 33 smoke tests passing. |
| 2026-08-26 | Phase 3-5 complete: expression evaluator, element-row adapter, scope resolution. 40 tests passing. |
| 2026-08-26 | Phase 6-8 + 10-11: execute() with SELECT, UPDATE, INSERT, DELETE, transactions, mutation triggers. 53 tests passing. |
| 2026-08-26 | ✅ Code review & bugfix pass: fixed INSERT column order & target resolution, DELETE rollback restoration, OLD/NEW trigger execution context, LIKE case-insensitivity, boolean coercion, and SELECT expression formatting. 57 tests passing. |
| 2026-08-26 | Phase 9 vertical slice: playground controller, isolated preview, editors, results/messages/AST/explorer panels, and 6 helper tests. 63 tests passing. |
| 2026-08-26 | ✅ Code review & bugfix pass: enabled skipLibCheck for clean typechecking, isolated triggerStack to execution state, fixed AFTER UPDATE trigger DOM timing, added positional default column mapping for column-less INSERT, allowed optional FROM in DELETE, and improved iframe Element formatting in playground display. 66 tests passing. |
| 2026-08-27 | Phase 12 compiler slice: added AST-backed callable JavaScript compiler, `executeProgram()` runtime boundary, playground Generated JavaScript output, and compiler tests. 69 tests passing. |
| 2026-08-27 | Phase 12 completion: real expression→JS-closure compiler, `sql` helper boundary reusing evaluator semantics, DOM snapshot utility, and interpreter/compiler differential tests. 83 tests passing; typecheck clean. |
| 2026-08-27 | Phase 14/15 slice: CSS.Rules declaration queries/updates, STATE table registry and updates, transaction rollback hooks, and 3 focused tests. 86 tests passing; typecheck clean. |
| 2026-08-27 | Browser completion: Vite entry point and styling, lazy Monaco editors with SQL completion/diagnostics, delegated event-trigger dispatch, computed-style rows, STATE INSERT/DELETE with rollback, and integration coverage. 89 tests passing; typecheck and Vite production build clean. |
