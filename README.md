# SQL-DOM

A SQL-inspired programming language and browser development playground for controlling HTML, CSS, and application state.

## Quick Start

```bash
# Install dependencies
npm install

# Run test suite (89 tests)
npm test

# Typecheck TypeScript
npm run typecheck

# Start the interactive playground
npm start
```

Visit `http://localhost:5173` to launch the **SQL-DOM Playground**.

## Features

- **Relational DOM Model**: Query and manipulate DOM elements as rows in the built-in `Elements` table.
- **Full CRUD Support**: `SELECT`, `UPDATE`, `INSERT INTO`, `DELETE FROM` with expression filtering, column projection, and `RETURNING`.
- **Atomic Transactions**: `BEGIN TRANSACTION`, `COMMIT`, and `ROLLBACK` with automatic reverse-mutation DOM restoration.
- **Live Event Triggers**: `CREATE TRIGGER ... AFTER CLICK` to execute SQL on user interactions.
- **Mutation Triggers**: Reactive triggers with `OLD` and `NEW` records.
- **CSS Stylesheet Table**: Query and update stylesheets relationally via `CSS.Rules`.
- **Application State Tables**: Bind and manipulate in-memory data structures via `STATE.<table>`.
- **AST Compiler**: Compile SQL ASTs into callable JavaScript functions.
- **SSMS-Style Browser Playground**: Monaco SQL editor with autocomplete, diagnostics squiggles, DOM preview iframe, Object Explorer inspector, results grid, and AST viewer.

## Documentation

- [`USER_GUIDE.md`](./USER_GUIDE.md) — Comprehensive user guide, language reference, and interactive demo walkthrough.
- [`implementation-plan.md`](./implementation-plan.md) — Architectural design and roadmap.
- [`PROGRESS.md`](./PROGRESS.md) — Implementation tracking and milestone progress.
