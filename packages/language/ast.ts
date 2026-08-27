// AST — the contract between lexer, parser, runtime, and compiler.
// Every SQL statement parsed produces nodes from these types.
// The runtime executes them directly; the compiler translates them to JS.

// ── Source locations ──────────────────────────────────────────

export interface SourceLocation {
  line: number;   // 1-based
  column: number; // 1-based
  offset: number; // 0-based character offset
}

export interface SourceSpan {
  start: SourceLocation;
  end: SourceLocation;
}

// Every AST node carries its source span for diagnostics.
export interface AstNode {
  type: string;
  span: SourceSpan;
}

// ── Identifiers & paths ───────────────────────────────────────

export interface Identifier extends AstNode {
  type: "identifier";
  name: string;
}

// Property paths like style.color or attributes.ariaLabel
export interface PropertyPath extends AstNode {
  type: "property_path";
  segments: Identifier[];  // at least one
}

// Element selector: #app, .counter, or a bare identifier like Elements
export interface ElementSelector extends AstNode {
  type: "element_selector";
  kind: "id" | "class" | "name";
  value: string;
}

// ── Literals ──────────────────────────────────────────────────

export interface StringLiteral extends AstNode {
  type: "literal_string";
  value: string;
}

export interface NumberLiteral extends AstNode {
  type: "literal_number";
  value: number;
}

export interface BooleanLiteral extends AstNode {
  type: "literal_boolean";
  value: boolean;
}

export interface NullLiteral extends AstNode {
  type: "literal_null";
}

export type Literal =
  | StringLiteral
  | NumberLiteral
  | BooleanLiteral
  | NullLiteral;

// ── Expressions ───────────────────────────────────────────────

// Column reference in an expression (e.g. tag, text)
export interface ColumnRef extends AstNode {
  type: "column_ref";
  name: string;
}

// OLD / NEW pseudo-references for mutation triggers
export interface OldNewRef extends AstNode {
  type: "old_new_ref";
  kind: "old" | "new";
  property?: Identifier;  // e.g. NEW.value
}

export type BinaryOperator =
  | "=" | "!=" | "<>" | "<" | "<=" | ">" | ">="
  | "AND" | "OR"
  | "+" | "-" | "*" | "/"
  | "LIKE";

export interface BinaryExpr extends AstNode {
  type: "binary_expr";
  operator: BinaryOperator;
  left: Expression;
  right: Expression;
}

export interface UnaryExpr extends AstNode {
  type: "unary_expr";
  operator: "NOT" | "-";
  operand: Expression;
}

export interface IsNullExpr extends AstNode {
  type: "is_null_expr";
  operand: Expression;
  not: boolean;  // true for IS NOT NULL
}

export interface FunctionCall extends AstNode {
  type: "function_call";
  name: string;
  args: Expression[];
}

export interface CastExpr extends AstNode {
  type: "cast_expr";
  operand: Expression;
  targetType: string;  // INT, DECIMAL, TEXT, etc.
}

export type Expression =
  | Literal
  | ColumnRef
  | OldNewRef
  | BinaryExpr
  | UnaryExpr
  | IsNullExpr
  | FunctionCall
  | CastExpr
  | PropertyPath;  // property paths can appear as targets in SET

// ── Source / scope ────────────────────────────────────────────

// The source of elements to operate on.
export type QuerySource =
  | { type: "global"; span: SourceSpan; table?: string }           // FROM Elements, FROM CSS.Rules
  | { type: "scoped"; selector: ElementSelector; span: SourceSpan }  // FROM #app, FROM .counter
  | { type: "children"; selector: ElementSelector; span: SourceSpan }
  | { type: "descendants"; selector: ElementSelector; span: SourceSpan }
  | { type: "parent"; selector: ElementSelector; span: SourceSpan };

// ── Statements ────────────────────────────────────────────────

// SELECT
export interface SelectStatement extends AstNode {
  type: "select";
  columns: SelectColumn[];
  source: QuerySource;
  where?: Expression;
}

export type SelectColumn =
  | { type: "star"; span: SourceSpan }          // SELECT *
  | { type: "column"; expr: Expression; alias?: string; span: SourceSpan };

// UPDATE
export interface UpdateStatement extends AstNode {
  type: "update";
  source: QuerySource;
  assignments: Assignment[];
  where?: Expression;
}

export interface Assignment extends AstNode {
  type: "assignment";
  target: PropertyPath;
  value: Expression;
}

// INSERT
export interface InsertStatement extends AstNode {
  type: "insert";
  source: QuerySource;          // INTO target
  columns: Identifier[];        // (col1, col2, ...)
  values: Expression[][];       // each row is an array of expressions
  returning?: Identifier[];     // RETURNING col1, col2
}

// DELETE
export interface DeleteStatement extends AstNode {
  type: "delete";
  source: QuerySource;
  where?: Expression;
}

// Transaction control
export interface BeginTransaction extends AstNode {
  type: "begin_transaction";
}

export interface CommitStatement extends AstNode {
  type: "commit";
}

export interface RollbackStatement extends AstNode {
  type: "rollback";
}

// Trigger
export interface CreateTriggerStatement extends AstNode {
  type: "create_trigger";
  name: string;
  target: ElementSelector;
  event: TriggerEvent;
  updateColumn?: string;  // for AFTER UPDATE OF <col>
  body: Statement[];       // the trigger body statements
}

export type TriggerEvent =
  | { type: "event"; name: "CLICK" | "CHANGE" | "INPUT" | "SUBMIT" | "FOCUS" | "BLUR" | "KEYDOWN" | "KEYUP" }
  | { type: "mutation"; name: "UPDATE" };

// ── Top-level statement union ─────────────────────────────────

export type Statement =
  | SelectStatement
  | UpdateStatement
  | InsertStatement
  | DeleteStatement
  | BeginTransaction
  | CommitStatement
  | RollbackStatement
  | CreateTriggerStatement;

// A program is a sequence of statements (separated by ;)
export interface Program extends AstNode {
  type: "program";
  statements: Statement[];
}

// ── Helpers ───────────────────────────────────────────────────

export type AstNodeType = AstNode["type"];

// Visitor pattern foundation
export interface AstVisitor<T> {
  visitProgram?(node: Program): T;
  visitSelect?(node: SelectStatement): T;
  visitUpdate?(node: UpdateStatement): T;
  visitInsert?(node: InsertStatement): T;
  visitDelete?(node: DeleteStatement): T;
  visitBeginTransaction?(node: BeginTransaction): T;
  visitCommit?(node: CommitStatement): T;
  visitRollback?(node: RollbackStatement): T;
  visitCreateTrigger?(node: CreateTriggerStatement): T;
  visitBinaryExpr?(node: BinaryExpr): T;
  visitUnaryExpr?(node: UnaryExpr): T;
  visitIsNullExpr?(node: IsNullExpr): T;
  visitFunctionCall?(node: FunctionCall): T;
  visitCastExpr?(node: CastExpr): T;
  visitStringLiteral?(node: StringLiteral): T;
  visitNumberLiteral?(node: NumberLiteral): T;
  visitBooleanLiteral?(node: BooleanLiteral): T;
  visitNullLiteral?(node: NullLiteral): T;
  visitColumnRef?(node: ColumnRef): T;
  visitOldNewRef?(node: OldNewRef): T;
  visitPropertyPath?(node: PropertyPath): T;
  visitAssignment?(node: Assignment): T;
}
